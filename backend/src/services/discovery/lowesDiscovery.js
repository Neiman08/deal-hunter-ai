/**
 * Lowe's Discovery Engine — Sitemap-based with Playwright fallback
 *
 * Primary: HTTP fetch of lowes.com/sitemap/detail{N}.xml
 *   Each file has thousands of /pd/ product URLs, no proxy needed.
 *
 * Fallback (triggered on 403/block): Playwright on category pages
 *   using the residential proxy (newBestBuyContext).
 *
 * URL discovery is pure HTTP. Product scraping uses the existing
 * Playwright scraper which runs through the residential proxy.
 */

const https            = require('https');
const http             = require('http');
const { filterNewUrls, sleep, runStoreDiscovery } = require('./baseRetailerDiscovery');
const { buildHttpProxyAgent } = require('../../utils/proxyUtils');
const { newContext, newBestBuyContext } = require('../browserEngine');
const { shouldSkipStore }    = require('../proxyManager');
const { writeStoreRun }      = require('../../utils/storeRunStats');
const logger  = require('../../utils/logger');

const STORE_SLUG  = 'lowes';
const STORE_LABEL = "Lowe's";

// Proxy auto-corrected by buildHttpProxyAgent (residential→22225, ISP→33335)
function makeProxyAgent() {
  return buildHttpProxyAgent('Lowes');
}

// Sitemap index: lowes.com/sitemap.xml → detail0.xml … detail400.xml
const SITEMAP_BASE  = 'https://www.lowes.com/sitemap/detail';
const SITEMAP_COUNT = 401;

// Playwright fallback — category listing pages
const PLAYWRIGHT_PAGES = [
  { label: 'clearance',      url: 'https://www.lowes.com/pl/Clearance/4294767752' },
  { label: 'power-tools',    url: 'https://www.lowes.com/pl/Power-tools/4294929124' },
  { label: 'appliances',     url: 'https://www.lowes.com/pl/Appliances/4294858921' },
  { label: 'outdoor-power',  url: 'https://www.lowes.com/pl/Outdoor-power-equipment/4294858909' },
  { label: 'dewalt',         url: 'https://www.lowes.com/store/brand/DEWALT/N-ahnzs' },
  { label: 'milwaukee',      url: 'https://www.lowes.com/store/brand/Milwaukee-Tool/N-1z17sp4' },
];

// Keywords in the URL slug that indicate resaleable merchandise
const INCLUDE_KEYWORDS = [
  // Power tools
  'drill', '-saw-', 'circular-saw', 'miter-saw', 'table-saw', 'reciprocating',
  'jigsaw', 'grinder', 'sander', 'router', 'nailer', 'impact-driver',
  'oscillating', 'rotary-tool', 'heat-gun', 'planer',
  // Outdoor power
  'mower', 'lawn-mower', 'riding-mower', 'blower', 'leaf-blower', 'trimmer',
  'chainsaw', 'chain-saw', 'pressure-washer', 'edger', 'tiller',
  // Major appliances
  'refrigerator', 'french-door', 'side-by-side', 'washer', 'dryer', 'dishwasher',
  'range', 'stove', 'oven', 'microwave', 'freezer', 'ice-maker',
  // HVAC & generators
  'air-conditioner', 'window-ac', 'portable-ac', 'dehumidifier', 'air-purifier',
  'generator', 'heater', 'space-heater', 'mini-split',
  // Storage
  'tool-chest', 'tool-cabinet', 'tool-bag', 'workbench', 'storage-cabinet',
  // Power / batteries
  'battery-pack', 'battery-charger', 'power-station',
  // Smart home
  'smart-thermostat', 'security-camera', 'smart-lock', 'smart-plug',
  // Vacuums
  'shop-vac', 'wet-dry-vac', 'vacuum',
  // Brands with high resale margin
  'dewalt', 'milwaukee', 'makita', 'bosch', 'ridgid', 'ryobi', 'craftsman',
  'ego-', 'greenworks', 'kobalt',
];

// Exclude service/install pages
const EXCLUDE_PREFIXES = [
  'service-', 'installation-', 'assembly-', 'haul-away',
  'warranty-', 'protection-plan-', 'measure-and-install',
];

function fetchText(url, hops = 0, agent = undefined) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  if (hops === 0 && agent === undefined) agent = makeProxyAgent();
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https:') ? https : http;
    const opts = {
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xml',
      },
    };
    if (agent) opts.agent = agent;
    const req = lib.get(url, opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location, hops + 1, agent).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

function isResaleableProduct(url) {
  const m = url.toLowerCase().match(/\/pd\/([^/?#]+)/);
  if (!m) return false;
  const slug = m[1];
  if (EXCLUDE_PREFIXES.some(p => slug.startsWith(p))) return false;
  return INCLUDE_KEYWORDS.some(kw => slug.includes(kw));
}

function seededShuffle(arr, seed) {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Playwright fallback ──────────────────────────────────────────────────────
async function runLowesPlaywrightFallback(options = {}) {
  logger.info(`[Discovery:${STORE_LABEL}] Switching to Playwright category fallback...`);

  function linkFilter(href) {
    if (!href || !href.includes('/pd/')) return false;
    const slug = (href.match(/\/pd\/([^/?#]+)/) || [])[1] || '';
    return !EXCLUDE_PREFIXES.some(p => slug.startsWith(p));
  }
  function cleanUrl(href) {
    const base = href.startsWith('http') ? href : `https://www.lowes.com${href}`;
    return base.split('?')[0].split('#')[0];
  }

  return runStoreDiscovery({
    storeSlug:           STORE_SLUG,
    storeLabel:          STORE_LABEL,
    pages:               PLAYWRIGHT_PAGES,
    getContext:          () => process.env.PROXY_ENABLED === 'true' ? newContext() : newBestBuyContext(),
    linkFilter,
    cleanUrl,
    maxPerPage:          options.maxPerPage || 30,
    maxTotal:            options.maxTotal   || 150,
    delayMs:             options.delayMs    || 2500,
    maxConsecutiveEmpty: 3,
  });
}

async function runLowesDiscovery(options = {}) {
  const startedAt = Date.now();
  const maxTotal = options.maxTotal || 150;
  const delayMs  = options.delayMs  || 2500;

  const stats = {
    store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, with_regular_price: 0, no_price: 0, errors: 0,
    blocked: false, blockType: null,
  };

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    stats.blocked = true;
    stats.blockType = 'skipped_due_to_failures';
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY (sitemap)`);
  logger.info(`   maxTotal=${maxTotal}`);
  logger.info('═'.repeat(60));

  const now         = new Date();
  const hour        = now.getHours();
  const day         = now.getDate();
  const cycleNum    = Math.floor(Date.now() / (30 * 60 * 1000));
  const sitemapIdx  = cycleNum % SITEMAP_COUNT;
  const sitemapUrl  = `${SITEMAP_BASE}${sitemapIdx}.xml`;
  const shuffleSeed = day * 1000 + sitemapIdx * 100 + Math.floor(hour / 4);

  logger.info(`[Discovery:${STORE_LABEL}] Cycle #${cycleNum} — sitemap index ${sitemapIdx}: ${sitemapUrl}`);

  let rawXml;
  try {
    rawXml = await fetchText(sitemapUrl);
    stats.pages_visited = 1;
  } catch (err) {
    logger.error(`[Discovery:${STORE_LABEL}] Sitemap fetch failed: ${err.message}`);
    // Playwright fallback on 403 or any block
    return runLowesPlaywrightFallback(options);
  }

  const allUrls    = rawXml.match(/https:\/\/www\.lowes\.com\/pd\/[^<\s"]+/g) || [];
  const candidates = allUrls
    .map(u => u.split('?')[0].replace(/\/$/, ''))
    .filter(isResaleableProduct);

  logger.info(`[Discovery:${STORE_LABEL}] ${allUrls.length} total → ${candidates.length} resaleable`);
  stats.urls_discovered = candidates.length;

  if (!candidates.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No resaleable products in sitemap file`);
    return stats;
  }

  const shuffled  = seededShuffle(candidates, shuffleSeed);
  const sample    = shuffled.slice(0, Math.min(maxTotal * 5, shuffled.length));
  const newUrls   = await filterNewUrls(sample, STORE_LABEL);
  stats.urls_new  = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All sampled URLs already in DB`);
    return stats;
  }

  logger.info(`\n[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} new products...`);

  const { scanSingleProduct } = require('../../jobs/scanJob');
  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 2;

  async function scanOne(url, idx) {
    logger.info(`[Discovery:${STORE_LABEL}] [${idx + 1}/${toProcess.length}] ${url}`);
    try {
      const result = await scanSingleProduct(STORE_SLUG, url);
      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        if (result.regularPrice) {
          stats.with_regular_price++;
          const discPct = Math.round((1 - result.currentPrice / result.regularPrice) * 100);
          logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${result.currentPrice} | ${discPct}% off $${result.regularPrice} | "${result.name || ''}"`);
        } else {
          logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${result.currentPrice} | no reg price | "${result.name || ''}"`);
        }
      } else {
        stats.no_price++;
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message}`);
    }
    await sleep(delayMs);
  }

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    await Promise.all(
      toProcess.slice(i, i + CONCURRENCY).map((url, j) => scanOne(url, i + j))
    );
  }

  // Final active-deals count
  const { query } = require('../../config/database');
  try {
    const dealRow = await query(`
      SELECT
        COUNT(*) FILTER (WHERE d.is_active = true) AS active,
        COUNT(*) FILTER (WHERE d.is_active = true AND d.regular_price IS NOT NULL AND d.regular_price > d.deal_price
          AND d.discount_percent >= 20 AND d.estimated_profit > 0 AND d.roi_percent > 5) AS real_opportunities
      FROM deals d
      JOIN stores s ON s.id = d.store_id
      WHERE s.slug = 'lowes'
    `);
    stats.active_deals       = parseInt(dealRow.rows[0]?.active        || 0);
    stats.real_opportunities = parseInt(dealRow.rows[0]?.real_opportunities || 0);
  } catch (e) {
    logger.warn(`[Discovery:${STORE_LABEL}] Could not query active deals: ${e.message}`);
  }

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   sitemap: index ${sitemapIdx} | urls_found: ${stats.urls_discovered}`);
  logger.info(`   new: ${stats.urls_new} | saved: ${stats.saved} | with_reg_price: ${stats.with_regular_price}`);
  logger.info(`   no_price: ${stats.no_price} | errors: ${stats.errors}`);
  logger.info(`   active_deals: ${stats.active_deals || 0} | real_opportunities: ${stats.real_opportunities || 0}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runLowesDiscovery, runDiscovery: runLowesDiscovery };

/**
 * Walmart Discovery Engine — Sitemap Strategy
 *
 * PerimeterX blocks all Playwright category pages ("Robot or human?").
 * ISP proxy is also blocked on listing pages.
 *
 * New approach: fetch product sitemaps via residential proxy (port 22225).
 * Walmart has sitemaps listed in robots.txt — we try them in order.
 * If all sitemaps are blocked, exit fast (< 60s) vs the old 25min Playwright cycle.
 *
 * Product URL pattern: walmart.com/ip/{name}/{itemId}
 */

const https = require('https');
const http  = require('http');
const { filterNewUrls, sleep } = require('./baseRetailerDiscovery');
const { shouldSkipStore }      = require('../proxyManager');
const { writeStoreRun }        = require('../../utils/storeRunStats');
const { buildHttpProxyAgent }  = require('../../utils/proxyUtils');
const { scanSingleProduct }    = require('../../jobs/scanJob');
const logger = require('../../utils/logger');

const STORE_SLUG  = 'walmart';
const STORE_LABEL = 'Walmart';

// Sitemaps to try (product-level, not category browse pages)
// Walmart publishes these in robots.txt — rotate by cycle number
const WALMART_SITEMAP_CANDIDATES = [
  'https://www.walmart.com/sitemap_item_1.xml',
  'https://www.walmart.com/sitemap_item_2.xml',
  'https://www.walmart.com/sitemap_item_3.xml',
  'https://www.walmart.com/sitemap_browse.xml',
];
const WALMART_ROBOTS_URL = 'https://www.walmart.com/robots.txt';

// Keywords that indicate resaleable high-margin products
const INCLUDE_KEYWORDS = [
  // Electronics
  'television', '-tv-', 'laptop', 'computer', 'tablet', 'ipad', 'monitor',
  'headphone', 'earphone', 'speaker', 'soundbar', 'camera', 'projector',
  'gaming', 'playstation', 'xbox', 'nintendo', 'console',
  // Appliances
  'refrigerator', 'washer', 'dryer', 'dishwasher', 'microwave', 'air-conditioner',
  'vacuum', 'instant-pot', 'air-fryer', 'coffee-maker', 'keurig', 'blender',
  // Power tools / outdoor
  'drill', 'circular-saw', 'miter-saw', 'grinder', 'impact-driver',
  'lawn-mower', 'pressure-washer', 'leaf-blower', 'trimmer', 'chainsaw',
  // Brands
  'dewalt', 'milwaukee', 'makita', 'ryobi', 'craftsman', 'dyson', 'shark',
  'kitchenaid', 'vitamix', 'instant-pot',
];

function isResaleableWalmartUrl(url) {
  const lower = url.toLowerCase();
  if (!lower.includes('/ip/')) return false;
  return INCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

function fetchText(url, hops = 0, agent = undefined) {
  if (hops > 4) return Promise.reject(new Error('Too many redirects'));
  if (hops === 0 && agent === undefined) agent = buildHttpProxyAgent('Walmart');
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https:') ? https : http;
    const opts = {
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };
    if (agent) opts.agent = agent;
    const req = lib.get(url, opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location, hops + 1, agent).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        const preview = [];
        res.on('data', c => { if (preview.join('').length < 500) preview.push(c); });
        res.on('end', () => {
          const body = preview.join('').slice(0, 500);
          reject(new Error(`HTTP ${res.statusCode} | body=${body.replace(/\s+/g, ' ')}`));
        });
        res.on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout 30s')); });
  });
}

// Discover sitemap URLs from robots.txt, then try known candidates
async function discoverSitemapUrls(cycleNum) {
  const agent = buildHttpProxyAgent('Walmart');

  // Try robots.txt to find declared sitemaps
  let declaredSitemaps = [];
  try {
    const robots = await fetchText(WALMART_ROBOTS_URL, 0, agent);
    const matches = [...robots.matchAll(/^Sitemap:\s*(https:\/\/www\.walmart\.com\/sitemap[^\s]+)/gim)];
    declaredSitemaps = matches.map(m => m[1]);
    logger.info(`[Discovery:${STORE_LABEL}] robots.txt: ${declaredSitemaps.length} sitemaps declared`);
  } catch (e) {
    logger.warn(`[Discovery:${STORE_LABEL}] robots.txt failed (${e.message.slice(0,80)}) — using hardcoded candidates`);
  }

  // Merge declared + hardcoded candidates, rotate by cycle
  const allCandidates = [...new Set([...declaredSitemaps, ...WALMART_SITEMAP_CANDIDATES])];
  const startIdx = cycleNum % allCandidates.length;
  const ordered  = [...allCandidates.slice(startIdx), ...allCandidates.slice(0, startIdx)];

  logger.info(`[Discovery:${STORE_LABEL}] Trying ${ordered.length} sitemap(s), starting at index ${startIdx}`);

  for (const sitemapUrl of ordered) {
    logger.info(`[Discovery:${STORE_LABEL}] Fetching ${sitemapUrl}`);
    try {
      const xml = await fetchText(sitemapUrl, 0, agent);

      // Sitemap index — look for nested sitemap refs
      const nestedRefs = [...xml.matchAll(/<loc>\s*(https:\/\/www\.walmart\.com\/sitemap[^<]+)\s*<\/loc>/g)].map(m => m[1]);
      if (nestedRefs.length > 0) {
        logger.info(`[Discovery:${STORE_LABEL}] Sitemap index — ${nestedRefs.length} nested sitemaps. Fetching first...`);
        const nested = await fetchText(nestedRefs[0], 0, agent);
        const urls = nested.match(/https:\/\/www\.walmart\.com\/ip\/[^<\s"]+/g) || [];
        logger.info(`[Discovery:${STORE_LABEL}] Nested sitemap: ${urls.length} product URLs`);
        return { urls, source: nestedRefs[0] };
      }

      // Direct product URLs
      const urls = xml.match(/https:\/\/www\.walmart\.com\/ip\/[^<\s"]+/g) || [];
      logger.info(`[Discovery:${STORE_LABEL}] Sitemap: ${urls.length} product URLs`);
      if (urls.length > 0) return { urls, source: sitemapUrl };

    } catch (err) {
      logger.warn(`[Discovery:${STORE_LABEL}] ${sitemapUrl} failed: ${err.message.slice(0, 120)}`);
    }
  }

  return null; // all sitemaps blocked
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

async function runWalmartDiscovery(options = {}) {
  const startedAt = Date.now();
  const maxTotal  = options.maxTotal || 150;
  const delayMs   = options.delayMs  || 2000;

  const stats = {
    store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0, blocked: false, blockType: null,
  };

  // Heartbeat — confirms this function is being invoked each cycle
  try {
    const { query: _hbQ } = require('../../config/database');
    await _hbQ(
      "INSERT INTO worker_store_runs (store_slug, started_at, blocked, block_type) VALUES ($1, NOW(), false, 'heartbeat_start')",
      [STORE_SLUG + '-hb']
    );
  } catch {}

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    stats.blocked = true; stats.blockType = 'skipped_due_to_failures';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY (sitemap via residential proxy)`);
  logger.info('═'.repeat(60));

  const cycleNum = Math.floor(Date.now() / (30 * 60 * 1000));

  // Try sitemaps via residential proxy
  let sitemapResult;
  try {
    sitemapResult = await Promise.race([
      discoverSitemapUrls(cycleNum),
      new Promise((_, rej) => setTimeout(() => rej(new Error('sitemap discovery timeout 90s')), 90000)),
    ]);
  } catch (err) {
    logger.error(`[Discovery:${STORE_LABEL}] Sitemap discovery failed: ${err.message}`);
    stats.blocked   = true;
    stats.blockType = 'sitemap_blocked';
    stats.last_error = err.message.slice(0, 500);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  if (!sitemapResult) {
    logger.warn(`[Discovery:${STORE_LABEL}] All sitemaps blocked by PerimeterX — needs residential proxy with US exit IP`);
    stats.blocked   = true;
    stats.blockType = 'sitemap_blocked';
    stats.last_error = 'All sitemap candidates returned non-200 via residential proxy';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  stats.pages_visited = 1;
  logger.info(`[Discovery:${STORE_LABEL}] Source: ${sitemapResult.source}`);

  // Filter to resaleable high-margin products
  const candidates = sitemapResult.urls
    .map(u => u.split('?')[0].split('#')[0])
    .filter(isResaleableWalmartUrl);

  stats.urls_discovered = candidates.length;
  logger.info(`[Discovery:${STORE_LABEL}] ${sitemapResult.urls.length} total → ${candidates.length} resaleable`);

  if (!candidates.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No resaleable products in sitemap`);
    stats.blockType = 'no_resaleable_urls';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  const seed     = cycleNum * 31337;
  const shuffled = seededShuffle(candidates, seed);
  const sample   = shuffled.slice(0, Math.min(maxTotal * 5, shuffled.length));
  const newUrls  = await filterNewUrls(sample, STORE_LABEL);
  stats.urls_new = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All sampled URLs already in DB`);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info(`\n[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} new products...`);

  // Pre-scan checkpoint
  await writeStoreRun(STORE_SLUG, startedAt, { ...stats, blockType: 'pre_scan_checkpoint' });

  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 2;

  async function scanOne(url, idx) {
    logger.info(`[Discovery:${STORE_LABEL}] [${idx + 1}/${toProcess.length}] ${url}`);
    try {
      const result = await scanSingleProduct(STORE_SLUG, url);
      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        const discStr = result.regularPrice
          ? `${Math.round((1 - result.currentPrice / result.regularPrice) * 100)}% off`
          : 'no reg price';
        logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${result.currentPrice} | ${discStr} | "${result.name || ''}"`);
      } else {
        stats.no_price++;
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message.slice(0, 100)}`);
    }
    await sleep(delayMs);
  }

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    await Promise.all(
      toProcess.slice(i, i + CONCURRENCY).map((url, j) => scanOne(url, i + j))
    );
  }

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   found:${stats.urls_discovered} new:${stats.urls_new} saved:${stats.saved} errors:${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runWalmartDiscovery, runDiscovery: runWalmartDiscovery };

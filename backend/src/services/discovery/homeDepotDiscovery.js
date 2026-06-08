/**
 * Home Depot Discovery Engine — Sitemap-first with Playwright fallback
 *
 * Strategy A (preferred): Fetch PIP-{N}.xml via BrightData residential proxy
 *   using https-proxy-agent (proper CONNECT tunnel, avoids TLS interception).
 *   Rotates through 88 sitemap files by hour.
 *
 * Strategy B (fallback): Playwright on category/clearance listing pages.
 *   Uses newBestBuyContext() which routes through residential proxy.
 *
 * Per user rule: "No insistir con Akamai si da 403."
 * If Strategy A is blocked, log once and immediately switch to B.
 */

const https = require('https');
const HttpsProxyAgent = require('https-proxy-agent');
const { newContext, newBestBuyContext } = require('../browserEngine');
const { filterNewUrls, sleep, runStoreDiscovery } = require('./baseRetailerDiscovery');
const { shouldSkipStore } = require('../proxyManager');
const { scanSingleProduct } = require('../../jobs/scanJob');
const logger = require('../../utils/logger');

const STORE_SLUG  = 'home-depot';
const STORE_LABEL = 'Home Depot';

// BrightData residential proxy
const PROXY_HOST = process.env.PROXY_HOST || 'brd.superproxy.io';
const PROXY_PORT = parseInt(process.env.PROXY_PORT) || 22225;
const PROXY_USER = process.env.PROXY_USER || 'brd-customer-hl_baafcac4-zone-residential_proxy1-country-us';
const PROXY_PASS = process.env.PROXY_PASS || 'p1p2vbv91h3i';
const PROXY_URL  = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;

// ── Proxy diagnostics (printed once at module load) ───────────────────────────
console.log('[Discovery:HomeDepot] ── PROXY CONFIG ──');
console.log(`[Discovery:HomeDepot] PROXY_ENABLED    = ${process.env.PROXY_ENABLED}`);
console.log(`[Discovery:HomeDepot] ISP_PROXY_ENABLED= ${process.env.ISP_PROXY_ENABLED}`);
console.log(`[Discovery:HomeDepot] PROXY_HOST       = ${PROXY_HOST}`);
console.log(`[Discovery:HomeDepot] PROXY_PORT       = ${PROXY_PORT}  (22225=residential 33335=ISP)`);
console.log(`[Discovery:HomeDepot] PROXY_USER       = ${PROXY_USER}`);
console.log(`[Discovery:HomeDepot] PROXY_PASS       = ${PROXY_PASS ? '***set***' : '(not set)'}`);
console.log(`[Discovery:HomeDepot] ISP_PROXY_HOST   = ${process.env.ISP_PROXY_HOST || '(not set)'}`);
console.log(`[Discovery:HomeDepot] ISP_PROXY_PORT   = ${process.env.ISP_PROXY_PORT || '(not set)'}`);
console.log(`[Discovery:HomeDepot] ISP_PROXY_USER   = ${process.env.ISP_PROXY_USER || '(not set)'}`);
const _maskedUrl = `http://${PROXY_USER}:***@${PROXY_HOST}:${PROXY_PORT}`;
console.log(`[Discovery:HomeDepot] Proxy URL        = ${_maskedUrl}`);
// Live test — same agent the sitemap fetch uses
(async () => {
  if (process.env.PROXY_ENABLED !== 'true') return;
  try {
    const _AgentCtor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
    const _agent = new _AgentCtor(PROXY_URL, { rejectUnauthorized: false });
    await new Promise((resolve) => {
      const _req = https.get('https://api.ipify.org?format=json', { agent: _agent, timeout: 10000, rejectUnauthorized: false }, _res => {
        const _chunks = [];
        _res.on('data', c => _chunks.push(c));
        _res.on('end', () => {
          try {
            const _ip = JSON.parse(Buffer.concat(_chunks).toString()).ip;
            console.log(`[Discovery:HomeDepot] Proxy test OK — exit IP: ${_ip}`);
          } catch { console.log(`[Discovery:HomeDepot] Proxy test OK (parse err)`); }
          resolve();
        });
        _res.on('error', e => { console.log(`[Discovery:HomeDepot] Proxy test READ ERR: ${e.message}`); resolve(); });
      });
      _req.on('error', e => { console.log(`[Discovery:HomeDepot] Proxy test FAIL: ${e.message}`); resolve(); });
      _req.on('timeout', () => { _req.destroy(); console.log(`[Discovery:HomeDepot] Proxy test TIMEOUT`); resolve(); });
    });
  } catch (e) {
    console.log(`[Discovery:HomeDepot] Proxy agent init FAIL: ${e.message}`);
  }
})();

// HD product sitemap index (88 files: PIP-0.xml … PIP-87.xml)
const SITEMAP_BASE  = 'https://www.homedepot.com/sitemap/P/PIPs/PIP/PIP-';
const SITEMAP_COUNT = 88;

// Playwright fallback — category listing pages
const DISCOVERY_PAGES = [
  { label: 'special-buy-of-the-day', url: 'https://www.homedepot.com/b/Deals-Special-Buy-of-the-Day/N-5yc1vZbrmw' },
  { label: 'clearance-tools',        url: 'https://www.homedepot.com/b/Tools/N-5yc1vZc1wx?sortby=price_low_to_high' },
  { label: 'clearance-appliances',   url: 'https://www.homedepot.com/b/Appliances/N-5yc1vZbwi2?sortby=price_low_to_high' },
  { label: 'clearance-outdoor',      url: 'https://www.homedepot.com/b/Outdoors-Lawn-Garden/N-5yc1vZbx9j?sortby=price_low_to_high' },
  { label: 'dewalt-sale',            url: 'https://www.homedepot.com/b/DEWALT/N-5yc1vZarls?sortby=price_low_to_high' },
  { label: 'milwaukee-sale',         url: 'https://www.homedepot.com/b/Milwaukee-Tool/N-5yc1vZarry?sortby=price_low_to_high' },
  { label: 'ryobi-sale',             url: 'https://www.homedepot.com/b/RYOBI/N-5yc1vZarlj?sortby=price_low_to_high' },
  { label: 'power-tools-deals',      url: 'https://www.homedepot.com/b/Tools-Power-Tools/N-5yc1vZc1wxZbwi4?sortby=price_low_to_high' },
  { label: 'outdoor-power',          url: 'https://www.homedepot.com/b/Outdoors-Outdoor-Power-Equipment/N-5yc1vZbwg1?sortby=price_low_to_high' },
];

// Keywords that indicate resaleable merchandise
const INCLUDE_KEYWORDS = [
  '/p/DEWALT', '/p/Milwaukee', '/p/RYOBI', '/p/RIDGID', '/p/Makita', '/p/Bosch',
  '/p/Craftsman', '/p/EGO', '/p/Greenworks', '/p/Husqvarna',
  'drill', 'saw', 'grinder', 'sander', 'nailer', 'router', 'impact',
  'mower', 'blower', 'trimmer', 'chainsaw', 'pressure-washer',
  'refrigerator', 'washer', 'dryer', 'dishwasher', 'range', 'freezer',
  'generator', 'air-conditioner', 'dehumidifier',
  'tool-chest', 'workbench', 'shop-vac',
];

function isResaleableHdUrl(url) {
  const lower = url.toLowerCase();
  if (!lower.includes('/p/') && !lower.match(/\/[a-z].*\/\d{9,}$/)) return false;
  return INCLUDE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
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

// Fetch HD sitemap via BrightData residential proxy (proper CONNECT tunnel)
function fetchSitemapViaProxy(url) {
  return new Promise((resolve, reject) => {
    let agent;
    try {
      // https-proxy-agent v5 default export is the constructor
      const AgentCtor = typeof HttpsProxyAgent === 'function'
        ? HttpsProxyAgent
        : HttpsProxyAgent.HttpsProxyAgent;
      agent = new AgentCtor(PROXY_URL, { rejectUnauthorized: false });
    } catch (e) {
      return reject(new Error(`Proxy agent init failed: ${e.message}`));
    }

    const req = https.get(url, {
      agent,
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept':     'text/html,application/xml,*/*',
        'Accept-Encoding': 'identity',
      },
    }, res => {
      if (res.statusCode === 403 || res.statusCode === 429) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} Akamai block`));
      }
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchSitemapViaProxy(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
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

// Strategy A: sitemap-based URL collection
async function discoverViaSitemap(hour, day, maxTotal) {
  const sitemapIdx = hour % SITEMAP_COUNT;
  const sitemapUrl = `${SITEMAP_BASE}${sitemapIdx}.xml`;

  logger.info(`[Discovery:${STORE_LABEL}] Strategy A — sitemap PIP-${sitemapIdx}.xml`);

  let rawXml;
  try {
    rawXml = await fetchSitemapViaProxy(sitemapUrl);
  } catch (err) {
    logger.warn(`[Discovery:${STORE_LABEL}] Sitemap blocked: ${err.message} — switching to Strategy B`);
    return null;
  }

  const allUrls = rawXml.match(/https:\/\/www\.homedepot\.com\/p\/[^<\s"]+/g) || [];
  const candidates = allUrls
    .map(u => u.split('?')[0].replace(/\/$/, ''))
    .filter(isResaleableHdUrl);

  logger.info(`[Discovery:${STORE_LABEL}] Sitemap: ${allUrls.length} total → ${candidates.length} resaleable`);

  if (!candidates.length) return null;

  const seed = day * 1000 + sitemapIdx * 100 + Math.floor(hour / 4);
  const shuffled = seededShuffle(candidates, seed);
  return shuffled.slice(0, Math.min(maxTotal * 5, shuffled.length));
}

// Strategy B: Playwright on listing pages (fallback)
async function discoverViaPlaywright(options) {
  function linkFilter(href) {
    return !!(href && href.includes('/p/') && href.match(/\/\d{9,}$/));
  }
  function cleanUrl(href) {
    const base = href.startsWith('http') ? href : `https://www.homedepot.com${href}`;
    return base.split('?')[0].split('#')[0];
  }
  return runStoreDiscovery({
    storeSlug:  STORE_SLUG,
    storeLabel: STORE_LABEL,
    pages:      DISCOVERY_PAGES,
    getContext: () => process.env.PROXY_ENABLED === 'true' ? newContext() : newBestBuyContext(),
    linkFilter,
    cleanUrl,
    maxPerPage: options.maxPerPage || 30,
    maxTotal:   options.maxTotal   || 150,
    delayMs:    options.delayMs    || 2000,
    maxConsecutiveEmpty: 3,
  });
}

async function runHomeDepotDiscovery(options = {}) {
  const maxTotal = options.maxTotal || 150;
  const delayMs  = options.delayMs  || 2000;

  const stats = {
    store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0, blocked: false, blockType: null,
  };

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    stats.blocked = true;
    stats.blockType = 'skipped_due_to_failures';
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY`);
  logger.info('═'.repeat(60));

  const now  = new Date();
  const hour = now.getHours();
  const day  = now.getDate();

  // Sitemap-only: if blocked by Akamai, skip entirely — no Playwright fallback
  const candidates = await discoverViaSitemap(hour, day, maxTotal);

  if (!candidates) {
    logger.warn(`[Discovery:${STORE_LABEL}] Sitemap blocked — trying Strategy B (Playwright listing pages)`);
    stats.blocked   = true;
    stats.blockType = 'sitemap_blocked_using_playwright';
    return discoverViaPlaywright({ ...options, maxTotal, delayMs });
  }

  // Strategy A succeeded — filter new URLs and scan
  stats.urls_discovered = candidates.length;
  stats.pages_visited   = 1;

  const newUrls   = await filterNewUrls(candidates, STORE_LABEL);
  stats.urls_new  = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All sampled URLs already in DB`);
    return stats;
  }

  logger.info(`[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} new products...`);

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
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message}`);
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

  return stats;
}

module.exports = { runHomeDepotDiscovery, runDiscovery: runHomeDepotDiscovery };

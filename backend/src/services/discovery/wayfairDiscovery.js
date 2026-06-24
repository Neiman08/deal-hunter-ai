/**
 * Wayfair Discovery Engine — PDP Sitemap + ISP Playwright
 *
 * Strategy:
 *  1. Fetch seo-pdp-index.xml (no proxy) → 954 child sitemap files.
 *  2. Pick 2 sitemap files (rotate by cycle day to vary products).
 *     Each file has 500 product URLs with image:loc tags.
 *  3. Filter for non-furniture resaleable categories:
 *     outdoor, lighting, storage, rugs, kitchen, tools.
 *  4. Dedup against products table.
 *  5. scanSingleProduct('wayfair', url) → ISP Playwright → JSON-LD pricing.
 *
 * Proxy cost: 0 for URL/image discovery; proxy only for product pages.
 * Wayfair has the most URLs of any store (~477,000 PDP pages).
 */

const https = require('https');
const http  = require('http');
const { filterNewUrls, sleep } = require('./baseRetailerDiscovery');
const { shouldSkipStore }  = require('../proxyManager');
const { writeStoreRun }    = require('../../utils/storeRunStats');
const { scanSingleProduct } = require('../../jobs/scanJob');
const { isStopRequested }  = require('../discoveryLock');
const { checkIspProxy407 } = require('../proxyHealthCheck');
const logger = require('../../utils/logger');

const STORE_SLUG  = 'wayfair';
const STORE_LABEL = 'Wayfair';

const SITEMAP_INDEX = 'https://www.wayfair.com/seo-pdp-index.xml';
const SITEMAP_BASE  = 'https://www.wayfair.com/seo-pdp-sitemap~';
const TOTAL_SITEMAPS = 954; // as of audit

// Wayfair categories with resale potential (exclude pure furniture)
const INCLUDE_URL_PATTERNS = [
  '/lighting/', '/outdoor/', '/storage/', '/organization/',
  '/rugs/', '/kitchen/', '/tools-hardware/', '/tools/',
  '/bbq-grills/', '/patio/', '/garden/',
  '/home-improvement/', '/appliances/',
  '/bath/', '/bedding/', '/area-rugs/',
];

// Exclude categories with very low resale
const EXCLUDE_URL_PATTERNS = [
  '/bedroom/pdp/', '/living-room-sets/', '/dining-sets/',
  '/sofas/', '/sectionals/', '/couches/',
  '/mattresses/', '/bed-frames/', '/desks/',
  '/office-chairs/', '/bookcases/',
  '/baby/', '/kids-furniture/', '/nursery/',
  '/art-prints/', '/canvas/',
];

// Also check URL slug for product types
const INCLUDE_KEYWORDS = [
  'lamp', 'light', 'chandelier', 'pendant', 'lantern', 'sconce',
  'outdoor', 'patio', 'garden', 'planter', 'fountain',
  'storage', 'shelf', 'shelving', 'cabinet', 'organizer', 'rack', 'bin',
  'rug', 'area-rug',
  'cookware', 'knife', 'kitchen',
  'grill', 'smoker', 'barbecue', 'bbq',
  'generator', 'power', 'tool',
  'fan', 'humidifier', 'dehumidifier', 'air-purifier',
  'vacuum', 'mop', 'steam',
  'mirror', 'clock', 'decor',
  'umbrella', 'hammock', 'fire-pit',
];

const EXCLUDE_KEYWORDS = [
  'sofa', 'sectional', 'couch', 'loveseat', 'recliner',
  'mattress', 'bed-frame', 'headboard', 'footboard',
  'dining-table', 'bookcase', 'desk',
  'baby', 'crib', 'stroller',
  'poster', 'canvas-print', 'artwork',
];

function isResaleableWayfairUrl(url) {
  const lower = url.toLowerCase();
  if (EXCLUDE_URL_PATTERNS.some(p => lower.includes(p))) return false;
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) return false;
  if (INCLUDE_URL_PATTERNS.some(p => lower.includes(p))) return true;
  return INCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, {
      timeout: 60000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location).then(resolve).catch(reject);
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
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout 60s')); });
  });
}

function parsePdpSitemap(xml) {
  const entries = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = urlRegex.exec(xml)) !== null) {
    const block = m[1];
    const locM  = block.match(/<loc>(https:\/\/www\.wayfair\.com[^<]*?\.html)<\/loc>/);
    const imgM  = block.match(/<image:loc>(.*?)<\/image:loc>/);
    if (locM) {
      entries.push({
        url:   locM[1].trim(),
        image: imgM ? imgM[1].trim() : null,
      });
    }
  }
  return entries;
}

// ─── Main Discovery ───────────────────────────────────────────────────────────

async function runDiscovery({ maxTotal = 60, delayMs = 4000, cycleNum = 0 } = {}) {
  const startedAt = new Date();

  const stats = {
    store: STORE_SLUG,
    pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0,
    blocked: false, blockType: null,
  };

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent proxy failures`);
    stats.blocked   = true;
    stats.blockType = 'skipped_due_to_failures';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏠 ${STORE_LABEL.toUpperCase()} DISCOVERY`);
  logger.info(`   maxTotal=${maxTotal} cycle=${cycleNum}`);
  logger.info('═'.repeat(60));

  // ── Phase 1: Pick sitemap files to fetch ──────────────────────────────────
  // Pick 3 random sitemap files — rotated by day so we don't always hit the same ones
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const startIdx  = (dayOfYear * 7 + cycleNum * 31) % TOTAL_SITEMAPS;
  const sitemapIndices = [
    startIdx % TOTAL_SITEMAPS,
    (startIdx + 317) % TOTAL_SITEMAPS,
    (startIdx + 631) % TOTAL_SITEMAPS,
  ];

  const allEntries = [];

  for (const idx of sitemapIndices) {
    if (isStopRequested()) break;
    if (allEntries.length >= maxTotal * 6) break;

    const sitemapUrl = `${SITEMAP_BASE}${idx}.xml`;
    logger.info(`[Discovery:${STORE_LABEL}] Fetching sitemap #${idx}: ${sitemapUrl}`);

    try {
      const xml = await fetchText(sitemapUrl);
      const entries = parsePdpSitemap(xml);
      logger.info(`[Discovery:${STORE_LABEL}] Sitemap #${idx}: ${entries.length} entries`);

      const filtered = entries.filter(e => isResaleableWayfairUrl(e.url));
      logger.info(`[Discovery:${STORE_LABEL}] ${filtered.length} resaleable products`);
      allEntries.push(...filtered);
      stats.pages_visited++;
    } catch (err) {
      logger.error(`[Discovery:${STORE_LABEL}] Sitemap #${idx} failed: ${err.message}`);
      stats.errors++;
    }
    await sleep(500); // small delay between sitemap fetches
  }

  if (!allEntries.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No product URLs found`);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  stats.urls_discovered = allEntries.length;

  // ── Phase 2: Dedup ─────────────────────────────────────────────────────────
  const rawUrls = allEntries.map(e => e.url);
  const newUrls = await filterNewUrls(rawUrls, STORE_LABEL);
  stats.urls_new = newUrls.length;

  const imageMap = Object.fromEntries(allEntries.map(e => [e.url, e.image]));
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All URLs already in DB`);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  // ── Proxy 407 guard — check before opening any browser ────────────────────
  const proxyCheck = await checkIspProxy407();
  if (!proxyCheck.ok) {
    logger.warn(`[Discovery:${STORE_LABEL}] ISP proxy unavailable (${proxyCheck.reason}) — aborting before PDP scrape`);
    stats.blocked   = true;
    stats.blockType = proxyCheck.reason;
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info(`[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} new products via ISP proxy...`);

  // ── Phase 3: Scan + Save ───────────────────────────────────────────────────
  for (let i = 0; i < toProcess.length; i++) {
    if (isStopRequested()) {
      logger.warn(`[Discovery:${STORE_LABEL}] Stop requested`);
      break;
    }

    const url    = toProcess[i];
    const imgUrl = imageMap[url] || null;

    logger.info(`[Discovery:${STORE_LABEL}] [${i + 1}/${toProcess.length}] ${url}`);

    try {
      const result = await scanSingleProduct(STORE_SLUG, url);

      if (result?.currentPrice && result?.saved) {
        // Supplement with sitemap image if scraper didn't capture one
        if (imgUrl && !result.imageUrl) {
          const { query } = require('../../config/database');
          await query(
            `UPDATE products SET image_url=$1 WHERE product_url=$2 AND image_url IS NULL`,
            [imgUrl, url]
          ).catch(() => {});
        }
        stats.saved++;
        logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${result.currentPrice} | "${result.name || ''}"`);
      } else {
        stats.no_price++;
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message.slice(0, 120)}`);
    }

    await sleep(delayMs);
  }

  logger.info('═'.repeat(60));
  logger.info(`🏠 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   found: ${stats.urls_discovered} | new: ${stats.urls_new} | saved: ${stats.saved} | errors: ${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runDiscovery };

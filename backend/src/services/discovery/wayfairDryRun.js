/**
 * Wayfair Dry Run — sitemap read only, ZERO proxy cost.
 *
 * Reads 3 Wayfair PDP sitemap files (Googlebot UA, no proxy) and returns:
 *  - urls_discovered: total filtered product URLs found
 *  - urls_new:        URLs not yet in products table (dedup check)
 *  - images_found:    how many have sitemap image:loc (free product images)
 *  - sample_urls:     up to 20 representative URLs
 *  - sample_images:   up to 10 image URLs from the sitemap
 *
 * NO Playwright. NO browser. NO ISP proxy. NO PDP loading.
 * Safe to run with PROXY_KILL_SWITCH=true.
 */

const https = require('https');
const http  = require('http');
const { filterNewUrls, sleep } = require('./baseRetailerDiscovery');
const logger = require('../../utils/logger');

const SITEMAP_BASE   = 'https://www.wayfair.com/seo-pdp-sitemap~';
const TOTAL_SITEMAPS = 954;

const INCLUDE_URL_PATTERNS = [
  '/lighting/', '/outdoor/', '/storage/', '/organization/',
  '/rugs/', '/kitchen/', '/tools-hardware/', '/tools/',
  '/bbq-grills/', '/patio/', '/garden/',
  '/home-improvement/', '/appliances/',
  '/bath/', '/bedding/', '/area-rugs/',
];
const EXCLUDE_URL_PATTERNS = [
  '/bedroom/pdp/', '/living-room-sets/', '/dining-sets/',
  '/sofas/', '/sectionals/', '/couches/',
  '/mattresses/', '/bed-frames/', '/desks/',
  '/office-chairs/', '/bookcases/',
  '/baby/', '/kids-furniture/', '/nursery/',
  '/art-prints/', '/canvas/',
];
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
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xml,*/*;q=0.8',
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
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout 30s')); });
  });
}

function parseSitemapEntries(xml) {
  const entries = [];
  const urlRe = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = urlRe.exec(xml)) !== null) {
    const block = m[1];
    const locM  = block.match(/<loc>(https:\/\/www\.wayfair\.com[^<]*?\.html)<\/loc>/);
    const imgM  = block.match(/<image:loc>(.*?)<\/image:loc>/);
    if (locM) entries.push({ url: locM[1].trim(), image: imgM ? imgM[1].trim() : null });
  }
  return entries;
}

/**
 * Run Wayfair dry-run: fetch 3 sitemaps, filter, dedup.
 * @param {object} opts
 * @param {boolean} opts.deduplicate  - dedup against DB (default true)
 * @param {number}  opts.sitemapCount - how many sitemaps to fetch (default 3)
 * @param {number}  opts.cycleNum     - rotation offset (default 0)
 */
async function runWayfairDryRun({ deduplicate = true, sitemapCount = 3, cycleNum = 0 } = {}) {
  const startedAt = Date.now();
  logger.info('[DryRun:Wayfair] Starting — no proxy, sitemap-only');

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const startIdx  = (dayOfYear * 7 + cycleNum * 31) % TOTAL_SITEMAPS;
  const indices   = Array.from({ length: sitemapCount }, (_, i) =>
    (startIdx + i * Math.ceil(TOTAL_SITEMAPS / sitemapCount)) % TOTAL_SITEMAPS
  );

  const allEntries = [];
  const sitemapsFetched = [];

  for (const idx of indices) {
    const url = `${SITEMAP_BASE}${idx}.xml`;
    logger.info(`[DryRun:Wayfair] Fetching sitemap #${idx}`);
    try {
      const xml     = await fetchText(url);
      const entries = parseSitemapEntries(xml);
      const filtered = entries.filter(e => isResaleableWayfairUrl(e.url));
      logger.info(`[DryRun:Wayfair] #${idx}: ${entries.length} total → ${filtered.length} resaleable`);
      allEntries.push(...filtered);
      sitemapsFetched.push({ index: idx, total: entries.length, filtered: filtered.length });
    } catch (err) {
      logger.error(`[DryRun:Wayfair] Sitemap #${idx} failed: ${err.message}`);
      sitemapsFetched.push({ index: idx, error: err.message });
    }
    await sleep(300);
  }

  const urlsDiscovered = allEntries.length;
  const withImages     = allEntries.filter(e => e.image).length;
  const sampleUrls     = allEntries.slice(0, 20).map(e => e.url);
  const sampleImages   = allEntries.filter(e => e.image).slice(0, 10).map(e => e.image);

  let urlsNew = urlsDiscovered;
  if (deduplicate && urlsDiscovered > 0) {
    try {
      const rawUrls = allEntries.map(e => e.url);
      const newUrls = await filterNewUrls(rawUrls, 'Wayfair');
      urlsNew = newUrls.length;
    } catch (err) {
      logger.warn(`[DryRun:Wayfair] Dedup failed: ${err.message}`);
    }
  }

  const elapsed = Date.now() - startedAt;
  const result = {
    mode:              'dry_run',
    proxy_used:        false,
    sitemaps_fetched:  sitemapsFetched,
    urls_discovered:   urlsDiscovered,
    urls_new:          urlsNew,
    images_found:      withImages,
    sample_urls:       sampleUrls,
    sample_images:     sampleImages,
    elapsed_ms:        elapsed,
  };

  logger.info(`[DryRun:Wayfair] Done — discovered=${urlsDiscovered} new=${urlsNew} images=${withImages} (${elapsed}ms)`);
  return result;
}

module.exports = { runWayfairDryRun };

/**
 * Discovery Base — shared utilities for all retailer discovery engines.
 *
 * Pattern:
 *   1. Open listing/search page (browser or HTTP)
 *   2. Extract product URLs
 *   3. Deduplicate against existing products.product_url
 *   4. For each new URL: scanSingleProduct(storeSlug, url) — N concurrent workers
 *   5. Return stats object
 *
 * Phase 10: SCAN_CONCURRENCY env var controls parallel product scans (default 3).
 */

// Use no-proxy browser for listing pages — proxy adds latency that causes timeouts
const { newBestBuyContext } = require('../browserEngine');
const { query }      = require('../../config/database');
const logger         = require('../../utils/logger');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Open a listing page with Playwright and extract product URLs.
 * @param {object} opts
 *   listingUrl     - full URL to scrape
 *   storeLabel     - e.g. "Lowes"
 *   linkFilter     - fn(href) => bool  (keep only product links)
 *   cleanUrl       - fn(href) => string  (normalize URL)
 *   maxUrls        - max per page (default 40)
 *   waitSelector   - CSS selector to wait for before extraction
 *   scrollSteps    - number of scroll increments (default 6)
 */
async function extractUrlsFromPage({
  listingUrl,
  storeLabel = 'Store',
  linkFilter,
  cleanUrl,
  maxUrls = 40,
  waitSelector = null,
  scrollSteps = 6,
}) {
  logger.info(`[Discovery:${storeLabel}] Extracting: ${listingUrl}`);
  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();
  const urls = [];

  try {
    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      if (!e.message.includes('timeout')) throw e;
    }

    const title = await page.title().catch(() => '');
    logger.info(`[Discovery:${storeLabel}]   title: "${title}"`);

    if (/captcha|robot|access denied|403|blocked/i.test(title)) {
      logger.warn(`[Discovery:${storeLabel}]   Blocked: "${title}"`);
      return [];
    }

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 12000 }).catch(() => {});
    }

    // Scroll to trigger lazy-load
    await page.evaluate(async (steps) => {
      for (let i = 0; i < steps; i++) {
        window.scrollBy(0, 600);
        await new Promise(r => setTimeout(r, 400));
      }
    }, scrollSteps);
    await sleep(1000);

    // Extract all anchor hrefs, apply filter + clean
    const raw = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
    );

    const seen = new Set();
    for (const href of raw) {
      if (!href || seen.size >= maxUrls) break;
      if (linkFilter && !linkFilter(href)) continue;
      const clean = cleanUrl ? cleanUrl(href) : (href.startsWith('http') ? href : `https://${new URL(listingUrl).host}${href}`);
      const canonical = clean.split('#')[0].split('?')[0];
      seen.add(canonical);
    }

    urls.push(...seen);
    logger.info(`[Discovery:${storeLabel}]   Found ${urls.length} URLs`);
  } catch (err) {
    logger.error(`[Discovery:${storeLabel}]   Error: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }

  return urls;
}

/**
 * Filter out URLs already in the products table.
 */
async function filterNewUrls(urls, storeLabel = 'Store') {
  if (!urls.length) return [];
  const existing = await query(
    `SELECT product_url FROM products WHERE product_url = ANY($1::text[])`,
    [urls]
  );
  const existingSet = new Set(existing.rows.map(r => r.product_url));
  const newUrls = urls.filter(u => !existingSet.has(u));
  logger.info(
    `[Discovery:${storeLabel}] Dedup: ${urls.length} found → ${existingSet.size} existing → ${newUrls.length} new`
  );
  return newUrls;
}

/**
 * Generic discovery runner.
 * @param {object} config
 *   storeSlug    - e.g. 'lowes'
 *   storeLabel   - e.g. 'Lowes'
 *   pages        - array of { label, url } discovery pages
 *   linkFilter   - fn(href) => bool
 *   cleanUrl     - fn(href) => string
 *   waitSelector - CSS to wait for on listing pages
 *   maxPerPage   - URLs per page (default 30)
 *   maxTotal     - total new products to scan (default 100)
 *   delayMs      - delay between product scans (default 2000)
 */
async function runDiscovery(config) {
  const {
    storeSlug,
    storeLabel = storeSlug,
    pages,
    linkFilter,
    cleanUrl,
    waitSelector,
    maxPerPage = 30,
    maxTotal   = 100,
    delayMs    = 2000,
  } = config;

  const { scanSingleProduct } = require('../../jobs/scanJob');

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${storeLabel.toUpperCase()} DISCOVERY`);
  logger.info(`   maxPerPage=${maxPerPage}  maxTotal=${maxTotal}`);
  logger.info('═'.repeat(60));

  const stats = { pages_visited: 0, urls_discovered: 0, urls_new: 0, saved: 0, no_price: 0, errors: 0 };

  // Phase 1: collect URLs (stop after 4 consecutive empty pages to avoid blocking loops)
  const allRaw = [];
  let consecutiveEmpty = 0;
  for (const p of pages) {
    if (allRaw.length >= maxTotal * 3) break;
    if (consecutiveEmpty >= 4) {
      logger.warn(`[Discovery:${storeLabel}] 4 consecutive empty pages — stopping early`);
      break;
    }
    logger.info(`\n[Discovery:${storeLabel}] ── ${p.label}`);
    const raw = await extractUrlsFromPage({
      listingUrl: p.url, storeLabel, linkFilter, cleanUrl,
      maxUrls: maxPerPage, waitSelector,
    });
    stats.pages_visited++;
    stats.urls_discovered += raw.length;
    allRaw.push(...raw);
    if (raw.length === 0) consecutiveEmpty++;
    else consecutiveEmpty = 0;
    await sleep(2000);
  }

  if (!allRaw.length) {
    logger.warn(`[Discovery:${storeLabel}] No URLs extracted.`);
    return stats;
  }

  // Phase 2: dedup
  const unique   = [...new Set(allRaw)];
  const newUrls  = await filterNewUrls(unique, storeLabel);
  stats.urls_new = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${storeLabel}] All URLs already in DB.`);
    return stats;
  }

  logger.info(`\n[Discovery:${storeLabel}] Processing ${toProcess.length} new URLs...`);

  // Phase 3: scan with concurrent workers (Phase 10 performance)
  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 3;

  async function scanOne(url, idx) {
    logger.info(`[Discovery:${storeLabel}] [${idx+1}/${toProcess.length}] ${url}`);
    try {
      const result = await scanSingleProduct(storeSlug, url);
      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        logger.info(`[Discovery:${storeLabel}]   ✅ $${result.currentPrice} | "${result.name || ''}"`);
      } else if (!result?.currentPrice) {
        stats.no_price++;
        logger.warn(`[Discovery:${storeLabel}]   ⚠️  no price`);
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${storeLabel}]   ❌ ${err.message}`);
    }
    await sleep(delayMs);
  }

  // Run in batches of CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((url, j) => scanOne(url, i + j)));
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${storeLabel.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   pages_visited:   ${stats.pages_visited}`);
  logger.info(`   urls_discovered: ${stats.urls_discovered}`);
  logger.info(`   urls_new:        ${stats.urls_new}`);
  logger.info(`   saved:           ${stats.saved}`);
  logger.info(`   no_price:        ${stats.no_price}`);
  logger.info(`   errors:          ${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  return stats;
}

module.exports = { extractUrlsFromPage, filterNewUrls, runDiscovery, sleep };

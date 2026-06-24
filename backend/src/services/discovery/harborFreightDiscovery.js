/**
 * Harbor Freight Discovery Engine — ISP Playwright category crawl
 *
 * Harbor Freight blocks ALL HTTP including Googlebot UA with PerimeterX.
 * sitemaps return 403 — must use ISP Playwright for URL discovery.
 *
 * Strategy:
 *  1. Load 2-3 HF category/clearance pages with withIspPage
 *  2. Extract all product links from those pages (anchor hrefs)
 *  3. Filter for resaleable tools via URL keywords + SKU pattern
 *  4. Dedup against products table
 *  5. scanSingleProduct('harbor-freight', url) → Apollo State → pricing
 *
 * Proxy cost: ~3-5 ISP loads for URL gather + 1 per product for pricing.
 */

const { withIspPage }        = require('../browserEngine');
const { filterNewUrls, sleep } = require('./baseRetailerDiscovery');
const { shouldSkipStore }    = require('../proxyManager');
const { writeStoreRun }      = require('../../utils/storeRunStats');
const { scanSingleProduct }  = require('../../jobs/scanJob');
const { isStopRequested }    = require('../discoveryLock');
const { checkIspProxy407 }   = require('../proxyHealthCheck');
const logger = require('../../utils/logger');

const STORE_SLUG  = 'harbor-freight';
const STORE_LABEL = 'Harbor Freight';

// Category pages to browse — rotate by cycleNum for variety
const CATEGORY_PAGES = [
  'https://www.harborfreight.com/clearance.html',
  'https://www.harborfreight.com/power-tools/drills.html',
  'https://www.harborfreight.com/generators.html',
  'https://www.harborfreight.com/air-tools-compressors.html',
  'https://www.harborfreight.com/hand-tools.html',
  'https://www.harborfreight.com/automotive/jacks-jack-stands.html',
  'https://www.harborfreight.com/welding.html',
  'https://www.harborfreight.com/storage-organization/tool-storage.html',
  'https://www.harborfreight.com/power-tools/grinders.html',
  'https://www.harborfreight.com/power-tools/saws.html',
];

// Tools/hardware that resell well
const INCLUDE_KEYWORDS = [
  'drill', 'grinder', 'sander', 'saw', 'router', 'impact', 'wrench',
  'screwdriver', 'ratchet', 'air-compressor', 'nail-gun', 'nailer',
  'spray-gun', 'generator', 'inverter', 'welder', 'plasma-cutter',
  'socket-set', 'wrench-set', 'plier', 'hammer', 'torque',
  'tool-chest', 'tool-cabinet', 'rolling-cart', 'parts-organizer',
  'floor-jack', 'jack-stand', 'car-lift', 'battery-charger', 'jump-starter',
  'oil-drain', 'brake-bleeder', 'engine-stand',
  'pressure-washer', 'parts-washer',
  'bauer', 'hercules', 'predator', 'u-s-general', 'us-general',
  'atlas', 'icon', 'fortress', 'portland',
  'led-work-light', 'work-light', 'flood-light',
  'clearance',
];

const EXCLUDE_KEYWORDS = [
  'gift-card', 'store-locator', 'coupon', 'inside-track', 'newsletter',
  'brands/', '/brand/', 'holiday', 'gift-guide',
];

function isResaleableHfUrl(url) {
  const lower = url.toLowerCase();
  if (!lower.includes('harborfreight.com')) return false;
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) return false;
  // Must be a product URL with SKU at end (4-6 digits before .html)
  if (!/\-\d{4,6}\.html$/.test(url)) return false;
  return INCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

async function extractProductLinksFromPage(page) {
  return page.evaluate(() => {
    const links = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (href && href.includes('harborfreight.com') && href.endsWith('.html')) {
        links.add(href.split('?')[0]); // strip query params
      }
    });
    return [...links];
  }).catch(() => []);
}

// ─── Main Discovery ───────────────────────────────────────────────────────────

async function runDiscovery({ maxTotal = 80, delayMs = 3000, cycleNum = 0 } = {}) {
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

  // ── Proxy 407 guard — before any browser is opened ────────────────────────
  const proxyCheck = await checkIspProxy407();
  if (!proxyCheck.ok) {
    logger.warn(`[Discovery:${STORE_LABEL}] ISP proxy unavailable (${proxyCheck.reason}) — aborting before category browse`);
    stats.blocked   = true;
    stats.blockType = proxyCheck.reason;
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🔧 ${STORE_LABEL.toUpperCase()} DISCOVERY`);
  logger.info(`   maxTotal=${maxTotal} cycle=${cycleNum}`);
  logger.info('═'.repeat(60));

  // ── Phase 1: Browse category pages via ISP Playwright ─────────────────────
  // Pick 2 category pages per cycle — rotate to cover all categories
  const pageCount = 2;
  const startPageIdx = (cycleNum * pageCount) % CATEGORY_PAGES.length;
  const pagesToVisit = [];
  for (let i = 0; i < pageCount; i++) {
    pagesToVisit.push(CATEGORY_PAGES[(startPageIdx + i) % CATEGORY_PAGES.length]);
  }
  // Always include clearance if cycleNum is even
  if (cycleNum % 2 === 0 && !pagesToVisit.includes(CATEGORY_PAGES[0])) {
    pagesToVisit.unshift(CATEGORY_PAGES[0]);
  }

  const allUrls = new Set();

  for (const catUrl of pagesToVisit) {
    if (isStopRequested()) break;

    logger.info(`[Discovery:${STORE_LABEL}] Browsing category: ${catUrl}`);
    try {
      const links = await withIspPage(catUrl, async (page) => {
        // Wait for product cards — HF is a React SPA, products render after JS hydration
        const PRODUCT_SELECTORS = [
          'article[class*="product"]',
          '[class*="ProductCard"] a[href]',
          '[data-testid*="product"] a[href]',
          '.grid-item a[href*=".html"]',
          'a[href*="-"][href$=".html"][class*="product"]',
        ].join(', ');
        try {
          await page.waitForSelector(PRODUCT_SELECTORS, { timeout: 15000 });
        } catch {
          // Fall back: wait extra time for SPA hydration then try anyway
          await page.waitForTimeout(3000);
          logger.warn(`[Discovery:${STORE_LABEL}] Product card selector timeout on ${catUrl} — scraping what's available`);
        }
        return extractProductLinksFromPage(page);
      });

      const filtered = links.filter(isResaleableHfUrl);
      logger.info(`[Discovery:${STORE_LABEL}] ${catUrl.split('/').pop()} → ${links.length} links, ${filtered.length} resaleable`);
      filtered.forEach(u => allUrls.add(u));
      stats.pages_visited++;
    } catch (err) {
      logger.error(`[Discovery:${STORE_LABEL}] Category page failed: ${err.message.slice(0, 120)}`);
      stats.errors++;
    }

    await sleep(2000);
  }

  const allUrlsArr = [...allUrls];
  stats.urls_discovered = allUrlsArr.length;

  if (!allUrlsArr.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No product URLs found from category pages`);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  // ── Phase 2: Dedup ─────────────────────────────────────────────────────────
  const shuffled = allUrlsArr.sort(() => Math.random() - 0.5);
  const newUrls  = await filterNewUrls(shuffled, STORE_LABEL);
  stats.urls_new = newUrls.length;

  const toProcess = newUrls.slice(0, maxTotal);
  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All URLs already in DB`);
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

    const url = toProcess[i];
    logger.info(`[Discovery:${STORE_LABEL}] [${i + 1}/${toProcess.length}] ${url}`);

    try {
      const result = await scanSingleProduct(STORE_SLUG, url);

      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${result.currentPrice} | "${result.name || ''}"`);
      } else {
        stats.no_price++;
        logger.info(`[Discovery:${STORE_LABEL}]   ⚠️  No price returned`);
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message.slice(0, 120)}`);
    }

    await sleep(delayMs);
  }

  logger.info('═'.repeat(60));
  logger.info(`🔧 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   found: ${stats.urls_discovered} | new: ${stats.urls_new} | saved: ${stats.saved} | errors: ${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runDiscovery };

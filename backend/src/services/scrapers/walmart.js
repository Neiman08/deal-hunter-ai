/**
 * Walmart Playwright Scraper
 *
 * Walmart aggressively detects headless browsers from datacenter IPs.
 * For reliable data, use a residential proxy (PROXY_ENABLED=true).
 *
 * Extraction order:
 *  1. window.__WML_REDUX_INITIAL_STATE__ — most complete, has clearance/rollback flags
 *  2. #__NEXT_DATA__ — fallback
 *  3. DOM price selectors — fallback
 */

const { withIspPage }       = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'walmart';
const DOMAIN     = 'walmart.com';

const PRICE_SELECTORS = [
  '[itemprop="price"]',
  '[data-automation-id="product-price"] span.inline-flex span',
  '.price-characteristic',
  '[class*="price-characteristic"]',
  '[data-testid="price"] span',
];

const STRIKE_SELECTORS = [
  '[data-automation-id="product-price-was"] span',
  '.was-price span',
  '[class*="strike"] span',
  '[data-testid="strike-through-price"] span',
];

async function scrapeWalmartProduct(url) {
  logger.info(`[Walmart] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withIspPage(url, async (page) => {

    try {
      await page.waitForSelector('[data-automation-id="product-price"], [itemprop="price"]', { timeout: 12000 });
    } catch {
      logger.warn('[Walmart] Price selector timeout — trying fallback methods');
    }

    // ── M1: Redux state ────────────────────────────────────────────────────
    const redux = await extractFromPageJSON(page, () => {
      try {
        const s = window?.__WML_REDUX_INITIAL_STATE__?.item?.item;
        if (!s) return null;
        return {
          name:      s.productAttributes?.name || s.name,
          brand:     s.productAttributes?.brand,
          sku:       String(s.usItemId || s.itemId || ''),
          upc:       s.upc,
          price:     s.priceInfo?.currentPrice?.price,
          wasPrice:  s.priceInfo?.wasPrice?.price,
          inStock:   s.availabilityStatus === 'IN_STOCK',
          imageUrl:  s.imageInfo?.allImages?.[0]?.url,
          clearance: !!s.priceInfo?.priceDisplayCodes?.clearance,
          rollback:  !!s.priceInfo?.priceDisplayCodes?.rollback,
        };
      } catch { return null; }
    }, 'WML_REDUX');

    if (redux?.price) {
      logger.info(`[Walmart] ✅ Redux | "${redux.name}" | $${redux.price} | clearance:${redux.clearance}`);
      return makeProduct({
        name: redux.name, brand: redux.brand, sku: redux.sku, upc: redux.upc,
        currentPrice: redux.price,
        regularPrice: redux.wasPrice || redux.price * 1.3,
        discountPercent: calcDiscount(redux.price, redux.wasPrice),
        inStock: redux.inStock, imageUrl: redux.imageUrl, productUrl: url,
        clearance: redux.clearance,
        pageText: [redux.clearance && 'clearance', redux.rollback && 'rollback'].filter(Boolean).join(' '),
        source: 'walmart_playwright_redux',
      });
    }

    // ── M2: __NEXT_DATA__ ──────────────────────────────────────────────────
    const next = await extractFromPageJSON(page, () => {
      try {
        const j = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
        const p = j?.props?.pageProps?.initialData?.data?.product;
        if (!p) return null;
        return {
          name: p.name, brand: p.brand,
          price: p.priceInfo?.currentPrice?.price,
          wasPrice: p.priceInfo?.wasPrice?.price,
          inStock: p.availabilityStatus === 'IN_STOCK',
          imageUrl: p.imageInfo?.thumbnailUrl,
        };
      } catch { return null; }
    }, '__NEXT_DATA__');

    if (next?.price) {
      logger.info(`[Walmart] ✅ NEXT_DATA | "${next.name}" | $${next.price}`);
      return makeProduct({
        name: next.name, brand: next.brand,
        currentPrice: next.price,
        regularPrice: next.wasPrice || next.price * 1.3,
        discountPercent: calcDiscount(next.price, next.wasPrice),
        inStock: next.inStock, imageUrl: next.imageUrl, productUrl: url,
        source: 'walmart_playwright_next',
      });
    }

    // ── M3: DOM selectors ──────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'walmart price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      const body  = await page.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
      throw new Error(`No price found. Title="${title}" | Body="${body.replace(/\n/g,' ')}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'walmart was-price');
    const name         = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const imageUrl     = await page.$eval('img[data-automation-id="product-image"], img[data-testid="hero-image"]', el => el.src).catch(() => null);
    const inStock      = await page.$('[data-automation-id="add-to-cart-button"]').then(Boolean).catch(() => true);
    const pageText     = await page.$eval('body', el => el.innerText?.slice(0, 1000)).catch(() => '');

    logger.info(`[Walmart] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, currentPrice,
      regularPrice: regularPrice || currentPrice * 1.3,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url, pageText,
      source: 'walmart_playwright_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 3, baseDelay: 3000, label: `Walmart` });
}

async function scanWalmartDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🛒 WALMART PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.upc, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'walmart' AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '25 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[Walmart] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeWalmartProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[Walmart] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[Walmart] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeWalmartProduct, scanWalmartDeals };

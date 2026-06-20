/**
 * Lowe's Playwright Scraper (Phase 2)
 *
 * Lowe's uses React with hydration data in window.__PRELOADED_STATE__.
 * Their pages are relatively scraper-friendly.
 *
 * Extraction order:
 *  1. window.__PRELOADED_STATE__ (React hydration state)
 *  2. LD+JSON schema
 *  3. DOM selectors
 */

const { withIspPage }   = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'lowes';
const DOMAIN     = 'lowes.com';

const PRICE_SELECTORS = [
  '[data-selector="price-section"] [class*="primary"]',
  '[class*="PrimaryPrice"]',
  '.primary-price',
  '[data-attr="current-price"]',
  '[id*="priceWrapper"] span',
  '.price-wrapper .price',
];

const STRIKE_SELECTORS = [
  '[data-selector="price-section"] [class*="secondary"]',
  '[class*="SecondaryPrice"]',
  '.secondary-price',
  '[data-attr="was-price"]',
];

function buildUrl(itemNumber) {
  return `https://www.lowes.com/pd/${itemNumber}`;
}

async function scrapeLowesProduct(url) {
  logger.info(`[Lowes] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withIspPage(url, async (page) => {

    try {
      await page.waitForSelector('[class*="PrimaryPrice"], [data-selector="price-section"]', { timeout: 15000 });
    } catch {
      logger.warn('[Lowes] Price selector timeout — trying fallback');
    }

    // ── M1: __PRELOADED_STATE__ ───────────────────────────────────────────
    const preloaded = await extractFromPageJSON(page, () => {
      try {
        const s = window?.__PRELOADED_STATE__;
        if (!s) return null;
        const product = s?.pdp?.pdpData?.product || s?.product?.product;
        if (!product) return null;
        const pricing = product.pricing || product.price || {};
        return {
          name:     product.description || product.title,
          brand:    product.brand || product.manufacturer,
          sku:      product.itemNumber || product.sku,
          price:    pricing.salePrice   ?? pricing.currentPrice ?? pricing.price,
          reg:      pricing.regularPrice ?? pricing.wasPrice,
          inStock:  product.inventory?.isInStock ?? true,
          imageUrl: product.images?.[0]?.url || product.primaryImage,
          clearance:product.clearance || pricing.isClearance || false,
        };
      } catch { return null; }
    }, '__PRELOADED_STATE__');

    if (preloaded?.price) {
      logger.info(`[Lowes] ✅ PRELOADED_STATE | "${preloaded.name}" | $${preloaded.price}`);
      return makeProduct({
        name: preloaded.name, brand: preloaded.brand, sku: preloaded.sku,
        currentPrice: preloaded.price,
        regularPrice: preloaded.reg || preloaded.price * 1.25,
        discountPercent: calcDiscount(preloaded.price, preloaded.reg),
        inStock: preloaded.inStock, imageUrl: preloaded.imageUrl, productUrl: url,
        clearance: preloaded.clearance,
        pageText: preloaded.clearance ? 'clearance' : '',
        source: 'lowes_playwright_state',
      });
    }

    // ── M2: LD+JSON ───────────────────────────────────────────────────────
    const ld = await extractFromPageJSON(page, () => {
      try {
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        for (const s of scripts) {
          const d = JSON.parse(s.textContent);
          if (d?.offers?.price) return {
            name: d.name, brand: d.brand?.name,
            price: d.offers.price,
            inStock: d.offers.availability?.includes('InStock'),
            imageUrl: d.image,
          };
        }
        return null;
      } catch { return null; }
    }, 'LD+JSON');

    if (ld?.price) {
      logger.info(`[Lowes] ✅ LD+JSON | "${ld.name}" | $${ld.price}`);
      return makeProduct({
        name: ld.name, brand: ld.brand,
        currentPrice: ld.price, regularPrice: ld.price * 1.25,
        inStock: ld.inStock, imageUrl: ld.imageUrl, productUrl: url,
        source: 'lowes_playwright_ldjson',
      });
    }

    // ── M3: DOM ───────────────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'lowes price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price on Lowes page. Title: "${title}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'lowes was');
    const name         = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const imageUrl     = await page.$eval('.main-image img, [data-selector="main-image"]', el => el.src).catch(() => null);
    const inStock      = await page.$('button[data-selector="add-to-cart"]').then(Boolean).catch(() => true);
    const pageText     = await page.$eval('body', el => el.innerText?.slice(0, 1000)).catch(() => '');

    logger.info(`[Lowes] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, currentPrice,
      regularPrice: regularPrice || currentPrice * 1.25,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url, pageText,
      source: 'lowes_playwright_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 3, baseDelay: 2500, label: `Lowes` });
}

async function scanLowesDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🟢 LOWES PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'lowes'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[Lowes] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeLowesProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[Lowes] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[Lowes] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeLowesProduct, scanLowesDeals };

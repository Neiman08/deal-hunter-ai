/**
 * TJ Maxx Playwright Scraper (Phase 3)
 *
 * TJX Companies React SPA. Extraction order:
 *  1. LD+JSON (schema.org Product)
 *  2. window.__INITIAL_STATE__ / window.__STATE__
 *  3. DOM selectors
 */

const { withPage }      = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'tj-maxx';
const DOMAIN     = 'tjmaxx.tjx.com';

const PRICE_SELECTORS = [
  '[data-auto="price"]',
  '[class*="ProductPrice"]',
  '[class*="price-value"]',
  '[class*="salePrice"]',
  '[itemprop="price"]',
  '.price',
];

const STRIKE_SELECTORS = [
  '[class*="compareAtPrice"]',
  '[class*="originalPrice"]',
  '[class*="wasPrice"]',
  '[data-auto="was-price"]',
  '.compare-price',
];

async function scrapeTjmaxxProduct(url) {
  logger.info(`[TJMaxx] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withPage(url, async (page) => {

    try {
      await page.waitForSelector('[data-auto="price"], [class*="ProductPrice"], [itemprop="price"]', { timeout: 15000 });
    } catch {
      logger.warn('[TJMaxx] Price selector timeout — trying fallback');
    }

    // ── M1: LD+JSON ───────────────────────────────────────────────────────
    const ld = await extractFromPageJSON(page, () => {
      try {
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        for (const s of scripts) {
          const d = JSON.parse(s.textContent);
          const item = d?.['@type'] === 'Product' ? d : (Array.isArray(d) ? d.find(i => i['@type'] === 'Product') : null);
          if (item?.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            return {
              name:    item.name,
              brand:   item.brand?.name || item.brand,
              sku:     item.sku || item.mpn,
              price:   parseFloat(offer.price),
              inStock: offer.availability?.toLowerCase().includes('instock'),
              image:   item.image?.[0] || item.image,
            };
          }
        }
        return null;
      } catch { return null; }
    }, 'LD+JSON');

    if (ld?.price) {
      logger.info(`[TJMaxx] ✅ LD+JSON | "${ld.name}" | $${ld.price}`);
      const regPrice = await extractPrice(page, STRIKE_SELECTORS, 'tj reg') || ld.price * 1.4;
      return makeProduct({
        name: ld.name, brand: ld.brand, sku: ld.sku,
        currentPrice: ld.price,
        regularPrice: regPrice,
        discountPercent: calcDiscount(ld.price, regPrice),
        inStock: ld.inStock ?? true,
        imageUrl: ld.image,
        productUrl: url,
        source: 'tjmaxx_ldjson',
      });
    }

    // ── M2: window state ──────────────────────────────────────────────────
    const state = await extractFromPageJSON(page, () => {
      try {
        const s = window.__INITIAL_STATE__ || window.__STATE__ || window.__APP_STATE__;
        if (!s) return null;
        const pd = s?.pdp || s?.productDetail || s?.product;
        if (!pd) return null;
        const p = pd?.product || pd;
        const pr = p?.pricing || p?.price || {};
        return {
          name:  p.name || p.title || p.displayName,
          brand: p.brand || p.brandName,
          sku:   p.sku || p.styleId,
          price: pr.salePrice ?? pr.currentPrice ?? pr.price,
          reg:   pr.compareAtPrice ?? pr.regularPrice ?? pr.originalPrice,
          inStock: p.inStock ?? p.inventory?.isInStock ?? true,
          image:   p.images?.[0]?.src || p.primaryImage,
        };
      } catch { return null; }
    }, 'window.__INITIAL_STATE__');

    if (state?.price) {
      logger.info(`[TJMaxx] ✅ window state | "${state.name}" | $${state.price}`);
      return makeProduct({
        name: state.name, brand: state.brand, sku: state.sku,
        currentPrice: state.price,
        regularPrice: state.reg || state.price * 1.4,
        discountPercent: calcDiscount(state.price, state.reg),
        inStock: state.inStock,
        imageUrl: state.image,
        productUrl: url,
        source: 'tjmaxx_state',
      });
    }

    // ── M3: DOM ───────────────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'tjmaxx price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price on TJMaxx page. Title: "${title}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'tjmaxx was');
    const name     = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const brand    = await page.$eval('[class*="brandName"], [itemprop="brand"]', el => el.textContent?.trim()).catch(() => null);
    const imageUrl = await page.$eval('[class*="ProductImage"] img, .product-image img', el => el.src).catch(() => null);
    const inStock  = await page.$('button[data-auto="add-to-cart"], button[class*="AddToCart"]').then(Boolean).catch(() => true);
    const pageText = await page.$eval('body', el => el.innerText?.slice(0, 500)).catch(() => '');

    const clearance = /clearance/i.test(pageText);

    logger.info(`[TJMaxx] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, brand, currentPrice,
      regularPrice: regularPrice || null,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url, clearance, pageText,
      source: 'tjmaxx_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 2, baseDelay: 3000, label: 'TJMaxx' });
}

async function scanTjmaxxDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🛍️  TJ MAXX PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'tj-maxx'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[TJMaxx] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeTjmaxxProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[TJMaxx] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[TJMaxx] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeTjmaxxProduct, scanTjmaxxDeals };

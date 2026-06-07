/**
 * Kohl's Playwright Scraper (Phase 3)
 *
 * Kohl's React SPA. Extraction order:
 *  1. LD+JSON (schema.org Product)
 *  2. window.__PRELOADED_STATE__ / window.digitalData
 *  3. DOM selectors
 */

const { withPage }      = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'kohls';
const DOMAIN     = 'kohls.com';

const PRICE_SELECTORS = [
  '.prc_sale',
  '[data-attribute="salePrice"]',
  '[class*="sale-price"]',
  '[class*="ProductPrice"] [class*="sale"]',
  '.final-price',
  '[itemprop="price"]',
  '.product-price .price',
];

const STRIKE_SELECTORS = [
  '.prc_reg',
  '[class*="regular-price"]',
  '[class*="RegularPrice"]',
  '.was-price',
  '[data-attribute="regularPrice"]',
];

async function scrapeKohlsProduct(url) {
  logger.info(`[Kohls] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withPage(url, async (page) => {

    try {
      await page.waitForSelector('.prc_sale, [class*="ProductPrice"], [itemprop="price"]', { timeout: 15000 });
    } catch {
      logger.warn('[Kohls] Price selector timeout — trying fallback');
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
              sku:     item.sku || item.productID,
              price:   parseFloat(offer.price),
              reg:     offer.priceSpecification?.referencePrice ?? null,
              inStock: offer.availability?.toLowerCase().includes('instock'),
              image:   item.image?.[0] || item.image,
            };
          }
        }
        return null;
      } catch { return null; }
    }, 'LD+JSON');

    if (ld?.price) {
      logger.info(`[Kohls] ✅ LD+JSON | "${ld.name}" | $${ld.price}`);
      const regPrice = ld.reg || await extractPrice(page, STRIKE_SELECTORS, 'kohls reg') || ld.price * 1.35;
      return makeProduct({
        name: ld.name, brand: ld.brand, sku: ld.sku,
        currentPrice: ld.price,
        regularPrice: regPrice,
        discountPercent: calcDiscount(ld.price, regPrice),
        inStock: ld.inStock ?? true,
        imageUrl: ld.image,
        productUrl: url,
        source: 'kohls_ldjson',
      });
    }

    // ── M2: __PRELOADED_STATE__ ───────────────────────────────────────────
    const preloaded = await extractFromPageJSON(page, () => {
      try {
        const s = window.__PRELOADED_STATE__ || window.__NEXT_DATA__?.props?.pageProps;
        if (!s) return null;
        const p = s?.product || s?.pdp?.product || s?.productData?.product;
        if (!p) return null;
        const pr = p.pricing || p.price || {};
        return {
          name:  p.name || p.productName,
          brand: p.brand?.name || p.brandName,
          sku:   p.webId || p.productId || p.sku,
          price: pr.salePrice ?? pr.finalPrice ?? pr.price,
          reg:   pr.regularPrice ?? pr.origPrice,
          inStock: p.availability?.toLowerCase()?.includes('instock') ?? true,
          image:   p.images?.[0]?.url || p.primaryImageUrl,
          clearance: pr.isClearance || /clearance/i.test(p.availability || ''),
        };
      } catch { return null; }
    }, '__PRELOADED_STATE__');

    if (preloaded?.price) {
      logger.info(`[Kohls] ✅ PRELOADED_STATE | "${preloaded.name}" | $${preloaded.price}`);
      return makeProduct({
        name: preloaded.name, brand: preloaded.brand, sku: preloaded.sku,
        currentPrice: preloaded.price,
        regularPrice: preloaded.reg || preloaded.price * 1.35,
        discountPercent: calcDiscount(preloaded.price, preloaded.reg),
        inStock: preloaded.inStock,
        imageUrl: preloaded.image,
        productUrl: url,
        clearance: preloaded.clearance || false,
        pageText: preloaded.clearance ? 'clearance' : '',
        source: 'kohls_preloaded',
      });
    }

    // ── M3: DOM ───────────────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'kohls price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price on Kohls page. Title: "${title}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'kohls reg');
    const name     = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const brand    = await page.$eval('[class*="brand"], [itemprop="brand"], .brand-name', el => el.textContent?.trim()).catch(() => null);
    const imageUrl = await page.$eval('.product-image img, [class*="ProductImage"] img', el => el.src).catch(() => null);
    const inStock  = await page.$('.add-to-cart-btn, [data-auto="add-to-cart"], #addToCart').then(Boolean).catch(() => true);
    const pageText = await page.$eval('body', el => el.innerText?.slice(0, 500)).catch(() => '');

    const clearance = /clearance/i.test(pageText);

    logger.info(`[Kohls] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, brand, currentPrice,
      regularPrice: regularPrice || currentPrice * 1.35,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url, clearance, pageText,
      source: 'kohls_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 2, baseDelay: 3000, label: 'Kohls' });
}

async function scanKohlsDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🏷️  KOHL\'S PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'kohls'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[Kohls] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeKohlsProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[Kohls] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[Kohls] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeKohlsProduct, scanKohlsDeals };

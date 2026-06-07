/**
 * Costco Playwright Scraper (Phase 3)
 *
 * Costco uses a traditional server-rendered page with embedded JSON data.
 * Extraction order:
 *  1. LD+JSON (schema.org Product)
 *  2. window.__NEXT_DATA__ / embedded product JSON
 *  3. DOM selectors
 */

const { withPage }      = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'costco';
const DOMAIN     = 'costco.com';

const PRICE_SELECTORS = [
  '[automation-id="productPrice"]',
  '#product_prices .price',
  '.product-price strong',
  '[class*="price"] strong',
  '.your-price .price',
  '[itemprop="price"]',
  '.pricing strong',
];

const STRIKE_SELECTORS = [
  '.s-price',
  '.reg-price',
  '[class*="regularPrice"]',
  '.list-price',
  '[automation-id="regularPrice"]',
];

async function scrapeCostcoProduct(url) {
  logger.info(`[Costco] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withPage(url, async (page) => {

    try {
      await page.waitForSelector('[automation-id="productPrice"], #product_prices, .product-price', { timeout: 15000 });
    } catch {
      logger.warn('[Costco] Price selector timeout — trying fallback');
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
              inStock: offer.availability?.toLowerCase().includes('instock'),
              image:   item.image?.[0] || item.image,
            };
          }
        }
        return null;
      } catch { return null; }
    }, 'LD+JSON');

    if (ld?.price) {
      logger.info(`[Costco] ✅ LD+JSON | "${ld.name}" | $${ld.price}`);
      const regPrice = await extractPrice(page, STRIKE_SELECTORS, 'costco reg') || ld.price * 1.25;
      return makeProduct({
        name: ld.name, brand: ld.brand, sku: ld.sku,
        currentPrice: ld.price,
        regularPrice: regPrice,
        discountPercent: calcDiscount(ld.price, regPrice),
        inStock: ld.inStock ?? true,
        imageUrl: ld.image,
        productUrl: url,
        source: 'costco_ldjson',
      });
    }

    // ── M2: window product data ───────────────────────────────────────────
    const embedded = await extractFromPageJSON(page, () => {
      try {
        // Costco sometimes embeds product data in a script tag as JSON
        const scripts = [...document.querySelectorAll('script:not([src])')];
        for (const s of scripts) {
          const text = s.textContent || '';
          if (text.includes('"itemNumber"') && text.includes('"finalPrice"')) {
            const match = text.match(/\{[^{}]*"itemNumber"[^{}]*"finalPrice"[^{}]*\}/);
            if (match) {
              const obj = JSON.parse(match[0]);
              if (obj.finalPrice) return obj;
            }
          }
        }
        // Also check __NEXT_DATA__
        if (window.__NEXT_DATA__) {
          const p = window.__NEXT_DATA__?.props?.pageProps?.product;
          if (p?.pricing) return { finalPrice: p.pricing.finalPrice, regPrice: p.pricing.regPrice, name: p.name };
        }
        return null;
      } catch { return null; }
    }, 'embedded JSON');

    if (embedded?.finalPrice) {
      logger.info(`[Costco] ✅ embedded | $${embedded.finalPrice}`);
      return makeProduct({
        currentPrice: embedded.finalPrice,
        regularPrice: embedded.regPrice || embedded.finalPrice * 1.25,
        discountPercent: calcDiscount(embedded.finalPrice, embedded.regPrice),
        inStock: true,
        productUrl: url,
        source: 'costco_embedded',
      });
    }

    // ── M3: DOM ───────────────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'costco price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price on Costco page. Title: "${title}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'costco reg');
    const name     = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const brand    = await page.$eval('[class*="brand"], [itemprop="brand"], .brand-name', el => el.textContent?.trim()).catch(() => null);
    const imageUrl = await page.$eval('.product-image img, [id*="product-image"] img', el => el.src).catch(() => null);
    const outOfStock = await page.$('.out-of-stock-message, [class*="outOfStock"]').then(Boolean).catch(() => false);
    const pageText = await page.$eval('body', el => el.innerText?.slice(0, 500)).catch(() => '');

    const clearance = /clearance|hot buy/i.test(pageText);

    logger.info(`[Costco] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, brand, currentPrice,
      regularPrice: regularPrice || currentPrice * 1.25,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock: !outOfStock, imageUrl, productUrl: url, clearance, pageText,
      source: 'costco_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 2, baseDelay: 3000, label: 'Costco' });
}

async function scanCostcoDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🛒 COSTCO PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'costco'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[Costco] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeCostcoProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[Costco] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[Costco] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeCostcoProduct, scanCostcoDeals };

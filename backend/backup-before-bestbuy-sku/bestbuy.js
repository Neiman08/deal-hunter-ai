/**
 * Best Buy Playwright Scraper
 *
 * Best Buy is the most scraper-friendly major retailer.
 * They don't aggressively block datacenter IPs.
 * Products load consistently with standard Playwright.
 *
 * Extraction order:
 *  1. window.__INITIAL_STATE__ (app state, has openBox, clearance, salePrice)
 *  2. LD+JSON schema (clean structured data)
 *  3. DOM price selectors
 */

const { withPage }      = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractPriceAttr, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'best-buy';
const DOMAIN     = 'bestbuy.com';

// Best Buy price selectors (May 2025)
const PRICE_SELECTORS = [
  '[data-testid="customer-price"] span[aria-hidden="true"]',
  '.priceView-customer-price span[aria-hidden="true"]',
  '[class*="priceView-hero-price"] span[aria-hidden="true"]',
  '.sr-only + span',
  '[data-testid="price"]',
  '.priceView-price',
];

const REGULAR_PRICE_SELECTORS = [
  '[data-testid="regular-price"] span[aria-hidden="true"]',
  '.priceView-was-price span[aria-hidden="true"]',
  '.was-price span',
  '[class*="regularPrice"] span',
];

function buildUrl(sku) {
  return `https://www.bestbuy.com/site/searchpage.jsp?st=${sku}`;
}

function buildDirectUrl(sku) {
  return `https://www.bestbuy.com/site/${sku}.p`;
}

async function scrapeBestBuyProduct(skuOrUrl) {
  const url = skuOrUrl.startsWith('http') ? skuOrUrl : buildDirectUrl(skuOrUrl);
  logger.info(`[BestBuy] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withPage(url, async (page) => {

    // Best Buy loads fast — wait for price element
    try {
      await page.waitForSelector('[data-testid="customer-price"], .priceView-customer-price', { timeout: 15000 });
    } catch {
      logger.warn('[BestBuy] Price selector timeout — trying fallback');
    }

    // ── M1: __INITIAL_STATE__ ─────────────────────────────────────────────
    const state = await extractFromPageJSON(page, () => {
      try {
        const s = window?.__INITIAL_STATE__;
        if (!s) return null;

        // Navigate to product detail — structure varies by page type
        const pdp = s?.pdp?.listings?.primary
                 || s?.page?.data?.pageData?.product
                 || s?.productDetail?.pdpData?.product
                 || null;

        if (!pdp) return null;

        const pricing = pdp.priceInfo || pdp.pricing || {};
        return {
          name:         pdp.name || pdp.title || pdp.productTitle,
          brand:        pdp.brand || pdp.manufacturer,
          sku:          pdp.sku,
          currentPrice: pricing.currentPrice ?? pricing.salePrice ?? pdp.salePrice ?? pdp.price,
          regularPrice: pricing.regularPrice ?? pdp.regularPrice,
          openBoxPrice: pdp.openBoxPrice ?? null,
          clearance:    pdp.clearance   ?? false,
          dealOfTheDay: pdp.dealEndDate ? true : false,
          inStock:      pdp.onlineAvailability !== false,
          imageUrl:     pdp.image || pdp.thumbnailImage,
        };
      } catch { return null; }
    }, '__INITIAL_STATE__');

    if (state?.currentPrice) {
      logger.info(`[BestBuy] ✅ __INITIAL_STATE__ | "${state.name}" | $${state.currentPrice} | clearance:${state.clearance}`);
      return makeProduct({
        name: state.name, brand: state.brand, sku: state.sku,
        currentPrice: state.currentPrice,
        regularPrice: state.regularPrice || state.currentPrice * 1.25,
        discountPercent: calcDiscount(state.currentPrice, state.regularPrice),
        inStock: state.inStock, imageUrl: state.imageUrl, productUrl: url,
        openBoxPrice: state.openBoxPrice,
        clearance: state.clearance,
        dealOfTheDay: state.dealOfTheDay,
        pageText: [
          state.clearance    && 'clearance',
          state.dealOfTheDay && 'deal of the day',
          state.openBoxPrice && 'open box',
        ].filter(Boolean).join(' '),
        source: 'bestbuy_playwright_state',
      });
    }

    // ── M2: LD+JSON structured data ───────────────────────────────────────
    const ldJson = await extractFromPageJSON(page, () => {
      try {
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        for (const s of scripts) {
          const d = JSON.parse(s.textContent);
          const offer = d?.offers || (Array.isArray(d) ? d[0]?.offers : null);
          if (offer?.price) return {
            name:         d.name,
            brand:        d.brand?.name,
            currentPrice: offer.price,
            inStock:      offer.availability?.includes('InStock'),
            imageUrl:     d.image,
          };
        }
        return null;
      } catch { return null; }
    }, 'LD+JSON');

    if (ldJson?.currentPrice) {
      logger.info(`[BestBuy] ✅ LD+JSON | "${ldJson.name}" | $${ldJson.currentPrice}`);
      return makeProduct({
        name: ldJson.name, brand: ldJson.brand,
        currentPrice: ldJson.currentPrice,
        regularPrice: ldJson.currentPrice * 1.25,
        inStock: ldJson.inStock, imageUrl: ldJson.imageUrl, productUrl: url,
        source: 'bestbuy_playwright_ldjson',
      });
    }

    // ── M3: DOM selectors ─────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'bestbuy price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price found on Best Buy page. Title: "${title}"`);
    }

    const regularPrice  = await extractPrice(page, REGULAR_PRICE_SELECTORS, 'bestbuy regular');
    const name          = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const imageUrl      = await page.$eval('.primary-image img, [data-testid="primary-image"]', el => el.src).catch(() => null);
    const inStock       = await page.$('button[data-button-state="ADD_TO_CART"]').then(Boolean).catch(() => true);
    const clearanceEl   = await page.$('[class*="clearance"], [data-testid="clearance"]').then(Boolean).catch(() => false);
    const pageText      = await page.$eval('body', el => el.innerText?.slice(0, 1000)).catch(() => '');

    logger.info(`[BestBuy] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, currentPrice,
      regularPrice: regularPrice || currentPrice * 1.25,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url,
      clearance: clearanceEl,
      pageText: clearanceEl ? 'clearance ' + pageText : pageText,
      source: 'bestbuy_playwright_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 3, baseDelay: 2000, label: `BestBuy` });
}

async function scanBestBuyDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🟦 BEST BUY PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'best-buy'
      AND (p.product_url IS NOT NULL OR p.sku IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[BestBuy] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    const url = p.product_url || (p.sku ? buildDirectUrl(p.sku) : null);
    if (!url) continue;
    try {
      const scraped = await scrapeBestBuyProduct(url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 10) stats.deals++;
    } catch (err) {
      logger.error(`[BestBuy] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[BestBuy] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeBestBuyProduct, scanBestBuyDeals, buildDirectUrl };

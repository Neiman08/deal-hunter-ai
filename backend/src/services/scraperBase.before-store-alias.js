/**
 * ScraperBase — base class for all store scrapers
 *
 * Provides:
 *  - Standard result shape
 *  - Retry with exponential backoff
 *  - Rate limiting per domain
 *  - Price extraction helpers
 *  - DB write: prices + deals + scan_logs
 *  - Full integration with opportunityEngine + liquidationDetector
 */

const { withPage } = require('./browserEngine');
const { query }    = require('../config/database');
const logger       = require('../utils/logger');
const { analyzeOpportunity }    = require('./opportunityEngine');
const { detectLiquidationType } = require('./liquidationDetector');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Per-domain delay buckets (ms between requests to same domain)
const DOMAIN_DELAYS = {
  'walmart.com':    3000,
  'bestbuy.com':    2000,
  'homedepot.com':  2500,
  'target.com':     2500,
  'lowes.com':      2000,
};

const lastRequestTime = {};

async function respectDomainDelay(domain) {
  const delay = DOMAIN_DELAYS[domain] || 2000;
  const last  = lastRequestTime[domain] || 0;
  const wait  = delay - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastRequestTime[domain] = Date.now();
}

/**
 * Standard product result shape.
 * Every scraper returns this exact object.
 */
function makeProduct(fields = {}) {
  return {
    name:            fields.name            || null,
    brand:           fields.brand           || null,
    sku:             fields.sku             || null,
    upc:             fields.upc             || null,
    currentPrice:    fields.currentPrice    !== undefined ? parseFloat(fields.currentPrice) : null,
    regularPrice:    fields.regularPrice    !== undefined ? parseFloat(fields.regularPrice) : null,
    discountPercent: fields.discountPercent !== undefined ? parseFloat(fields.discountPercent) : null,
    inStock:         fields.inStock         !== undefined ? Boolean(fields.inStock) : null,
    stockQty:        fields.stockQty        !== undefined ? parseInt(fields.stockQty) || null : null,
    imageUrl:        fields.imageUrl        || null,
    productUrl:      fields.productUrl      || null,
    clearance:       fields.clearance       || false,
    openBoxPrice:    fields.openBoxPrice    || null,
    dealOfTheDay:    fields.dealOfTheDay    || false,
    pageText:        fields.pageText        || '',   // raw text for liquidation detection
    source:          fields.source          || 'playwright',
    data_source:     'live',
    scrapedAt:       new Date().toISOString(),
  };
}

/**
 * Retry wrapper with exponential backoff.
 * Does NOT catch silently — re-throws after max attempts.
 */
async function withRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const baseDelay   = options.baseDelay   || 2000;
  const label       = options.label       || 'scrape';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;

      logger.warn(`[${label}] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

      if (isLast) {
        logger.error(`[${label}] All ${maxAttempts} attempts failed — giving up`);
        throw err;  // Never swallowed
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.info(`[${label}] Waiting ${delay}ms before retry...`);
      await sleep(delay);
    }
  }
}

// ─── Price extraction helpers ─────────────────────────────────────────────────

/**
 * Try multiple CSS selectors until one returns a non-null price.
 * Logs which selector succeeded or why each failed.
 */
async function extractPrice(page, selectors, label = 'price') {
  for (const sel of selectors) {
    try {
      const text = await page.$eval(sel, el => el.textContent?.trim());
      if (!text) {
        logger.debug(`[PriceExtract] "${sel}" → empty text`);
        continue;
      }
      const price = parseTextPrice(text);
      if (price && price > 0) {
        logger.debug(`[PriceExtract] "${sel}" → ${text} → $${price}`);
        return price;
      }
      logger.debug(`[PriceExtract] "${sel}" → "${text}" → could not parse as price`);
    } catch {
      // Selector didn't match — try next
    }
  }
  logger.warn(`[PriceExtract] No selector matched for "${label}". Tried: ${selectors.join(', ')}`);
  return null;
}

/**
 * Try multiple attribute-based selectors (data-price, aria-label, etc.)
 */
async function extractPriceAttr(page, selectors, label = 'price-attr') {
  for (const { sel, attr } of selectors) {
    try {
      const val = await page.$eval(sel, (el, a) => el.getAttribute(a), attr);
      if (!val) continue;
      const price = parseTextPrice(val);
      if (price && price > 0) {
        logger.debug(`[PriceAttr] "${sel}[${attr}]" → "${val}" → $${price}`);
        return price;
      }
    } catch {
      // Selector not found
    }
  }
  return null;
}

/**
 * Extract price from JSON embedded in page (window.__INITIAL_STATE__, etc.)
 */
async function extractFromPageJSON(page, extractFn, label = 'json') {
  try {
    const result = await page.evaluate(extractFn);
    if (result) {
      logger.debug(`[PageJSON] ${label} → ${JSON.stringify(result).slice(0, 100)}`);
    }
    return result;
  } catch (err) {
    logger.debug(`[PageJSON] ${label} failed: ${err.message}`);
    return null;
  }
}

/** Parse "$1,299.99" / "1299.99" / "1,299" → 1299.99 */
function parseTextPrice(text) {
  if (!text) return null;
  const clean = String(text).replace(/[^0-9.]/g, '');
  const num   = parseFloat(clean);
  return isNaN(num) || num <= 0 ? null : num;
}

/** Compute discount percent, returns 0 if not applicable */
function calcDiscount(current, regular) {
  if (!current || !regular || regular <= current) return 0;
  return Math.round(((regular - current) / regular) * 100 * 10) / 10;
}

// ─── DB writes ────────────────────────────────────────────────────────────────

/**
 * Saves a scraped product to prices + deals tables.
 * Ties into opportunityEngine and liquidationDetector.
 * Returns the deal analysis object.
 */
async function saveProductData(dbProduct, scraped, storeSlug) {
  const { currentPrice, regularPrice, inStock, stockQty, pageText, imageUrl, productUrl } = scraped;

  if (!currentPrice) {
    logger.warn(`[SaveProduct] No currentPrice for "${dbProduct.name}" — skip DB write`);
    return null;
  }

  const regPrice    = regularPrice || currentPrice * 1.4;
  const discountPct = calcDiscount(currentPrice, regPrice);

  // 1. Price history
  await query(`
    INSERT INTO prices (product_id, regular_price, current_price, in_stock, stock_quantity, source)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [dbProduct.id, regPrice, currentPrice, inStock ?? true, stockQty, `${storeSlug}_playwright`]);

  // 2. Update product metadata
  if (imageUrl || productUrl) {
    await query(`
      UPDATE products SET
        image_url   = COALESCE($1, image_url),
        product_url = COALESCE($2, product_url),
        updated_at  = NOW()
      WHERE id = $3
    `, [imageUrl, productUrl, dbProduct.id]);
  }

  // 3. Opportunity analysis
  const analysis    = await analyzeOpportunity(dbProduct, currentPrice, regPrice, stockQty, dbProduct.cat_slug);

  // 4. Liquidation detection
  const liqResult   = detectLiquidationType(dbProduct, { discountPercent: discountPct }, pageText || '');

  // 5. Upsert deal — always mark as 'live'
  await query(`
    INSERT INTO deals (
      product_id, store_id, regular_price, deal_price, discount_percent,
      resale_price_amazon, resale_price_ebay, resale_price_facebook,
      estimated_profit, roi_percent, demand_level, estimated_days_to_sell,
      opportunity_score, opportunity_label, score_breakdown,
      stock_quantity, is_error_price,
      liquidation_type, liquidation_badge, liquidation_color,
      is_active, expires_at, data_source
    )
    SELECT
      $1, s.id, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14,
      $15, $16,
      $17, $18, $19,
      true, NOW() + INTERVAL '48 hours', 'live'
    FROM stores WHERE slug = $20
    ON CONFLICT (product_id, store_id) DO UPDATE SET
      deal_price        = EXCLUDED.deal_price,
      discount_percent  = EXCLUDED.discount_percent,
      resale_price_amazon  = EXCLUDED.resale_price_amazon,
      resale_price_ebay    = EXCLUDED.resale_price_ebay,
      resale_price_facebook= EXCLUDED.resale_price_facebook,
      estimated_profit  = EXCLUDED.estimated_profit,
      roi_percent       = EXCLUDED.roi_percent,
      demand_level      = EXCLUDED.demand_level,
      opportunity_score = EXCLUDED.opportunity_score,
      opportunity_label = EXCLUDED.opportunity_label,
      score_breakdown   = EXCLUDED.score_breakdown,
      stock_quantity    = EXCLUDED.stock_quantity,
      is_error_price    = EXCLUDED.is_error_price,
      liquidation_type  = EXCLUDED.liquidation_type,
      liquidation_badge = EXCLUDED.liquidation_badge,
      liquidation_color = EXCLUDED.liquidation_color,
      data_source       = 'live',
      last_seen_at      = NOW(),
      is_active         = true
  `, [
    dbProduct.id, regPrice, currentPrice, discountPct,
    analysis.resale?.amazonPrice,  analysis.resale?.ebayPrice,  analysis.resale?.fbPrice,
    analysis.resale?.netProfit,    analysis.resale?.roi,        analysis.resale?.demandLevel,
    analysis.resale?.estimatedDaysToSell,
    analysis.score, analysis.label, JSON.stringify(analysis.breakdown || {}),
    stockQty, analysis.isErrorPrice,
    liqResult?.type, liqResult?.badge, liqResult?.color,
    storeSlug,
  ]);

  logger.info(`[SaveProduct] ✅ "${dbProduct.name}" | $${currentPrice} | score=${analysis.score} | ${liqResult?.badge || 'no liquidation'}`);

  return { analysis, liqResult, discountPct };
}

module.exports = {
  withRetry,
  respectDomainDelay,
  makeProduct,
  extractPrice,
  extractPriceAttr,
  extractFromPageJSON,
  parseTextPrice,
  calcDiscount,
  saveProductData,
};

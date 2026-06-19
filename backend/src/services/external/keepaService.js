const axios = require('axios');
const { query } = require('../../config/database');
const logger = require('../../utils/logger');

const KEEPA_BASE = 'https://api.keepa.com/product';
const DOMAIN = process.env.KEEPA_DOMAIN || '1';
const CACHE_HOURS = parseFloat(process.env.KEEPA_CACHE_HOURS || '24');

// Simple in-process rate limiter: max 10 calls per minute
const callTimestamps = [];
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - 60000;
  // Drop timestamps older than 1 min
  while (callTimestamps.length && callTimestamps[0] < windowStart) callTimestamps.shift();
  if (callTimestamps.length >= 10) {
    throw new Error('Keepa rate limit: max 10 calls/min (internal limit)');
  }
  callTimestamps.push(now);
}

function isEnabled() {
  return process.env.KEEPA_ENABLED !== 'false' && !!process.env.KEEPA_API_KEY;
}

// Keepa prices are in cents; -1 = no data
function toDollar(val) {
  return val !== null && val !== undefined && val > 0 ? Math.round(val) / 100 : null;
}

function parseKeepaProduct(product, requestedUpc) {
  if (!product) return null;
  const stats = product.stats || {};
  const current = stats.current || [];
  const avg90 = stats.avg90 || [];
  const avg180 = stats.avg180 || [];

  // Price type indices: 0=Amazon, 1=New, 2=Used, 8=BuyBox
  const amazonCurrent = toDollar(current[0]);
  const buyBox = toDollar(current[8]);
  const newPrice = toDollar(current[1]);
  const usedPrice = toDollar(current[2]);
  const avg90Price = toDollar(avg90[8]) ?? toDollar(avg90[0]);
  const avg180Price = toDollar(avg180[8]) ?? toDollar(avg180[0]);

  // Image from imagesCSV
  const firstImg = (product.imagesCSV || '').split(',')[0];
  const imageUrl = firstImg ? `https://images-na.ssl-images-amazon.com/images/I/${firstImg}` : null;

  // Sales rank — last value in salesRanks for primary category
  // Keepa uses -1 to mean "no data"; filter it out so -1 doesn't score as a valid rank
  let salesRank = null;
  if (product.salesRanks) {
    const firstCatData = Object.values(product.salesRanks)[0];
    if (Array.isArray(firstCatData) && firstCatData.length >= 2) {
      const raw = firstCatData[firstCatData.length - 1];
      salesRank = raw > 0 ? raw : null;
    }
  }

  // Category from categoryTree
  let category = null;
  if (Array.isArray(product.categoryTree) && product.categoryTree.length > 0) {
    category = product.categoryTree[product.categoryTree.length - 1]?.name || null;
  }

  const isAmazonInStock = amazonCurrent !== null;
  const offersCount = product.offersSuccessful || 0;

  const upc = requestedUpc || (product.upcList && product.upcList[0]) || null;

  // Confidence score
  let confidence = 0;
  if (buyBox) confidence += 40;
  if (amazonCurrent) confidence += 20;
  if (avg90Price) confidence += 20;
  if (salesRank) confidence += 10;
  if (upc) confidence += 10;

  // Compact raw summary (no full csv arrays to keep storage small)
  const rawSummary = {
    asin: product.asin,
    title: product.title,
    brand: product.brand,
    upcList: product.upcList,
    tokensConsumed: product._tokensConsumed,
  };

  return {
    asin: product.asin,
    upc,
    title: product.title || null,
    brand: product.brand || null,
    image_url: imageUrl,
    amazon_current_price: amazonCurrent,
    amazon_buy_box_price: buyBox,
    amazon_90d_avg_price: avg90Price,
    amazon_180d_avg_price: avg180Price,
    amazon_new_price: newPrice,
    amazon_used_price: usedPrice,
    sales_rank: salesRank,
    category,
    is_amazon_in_stock: isAmazonInStock,
    offers_count: offersCount,
    keepa_confidence: confidence,
    raw_summary: rawSummary,
  };
}

async function callKeepaApi(params) {
  const key = process.env.KEEPA_API_KEY;
  checkRateLimit();
  logger.info(`[Keepa] fetching ${JSON.stringify({ ...params, key: '[REDACTED]' })}`);
  const res = await axios.get(KEEPA_BASE, {
    params: { key, domain: DOMAIN, stats: 180, buybox: 1, history: 0, ...params },
    timeout: 20000,
  });
  if (!res.data || !Array.isArray(res.data.products)) {
    throw new Error('Keepa API returned unexpected response');
  }
  logger.info(`[Keepa] tokensLeft=${res.data.tokensLeft ?? 'unknown'} products=${res.data.products.length}`);
  return res.data;
}

async function getCachedMarketData({ productId, upc, asin }) {
  const cacheMs = CACHE_HOURS * 3600000;
  const conditions = [];
  const params = [];
  let p = 1;

  if (productId) { conditions.push(`product_id = $${p++}`); params.push(productId); }
  else if (upc) { conditions.push(`upc = $${p++}`); params.push(upc); }
  else if (asin) { conditions.push(`asin = $${p++}`); params.push(asin); }
  else return null;

  conditions.push(`fetched_at > NOW() - ($${p++} * INTERVAL '1 millisecond')`);
  params.push(cacheMs);

  const r = await query(
    `SELECT * FROM product_market_data WHERE ${conditions.join(' AND ')} ORDER BY fetched_at DESC LIMIT 1`,
    params
  );
  return r.rows[0] || null;
}

async function saveKeepaMarketData(productId, data) {
  const {
    asin, upc, title, brand, image_url,
    amazon_current_price, amazon_buy_box_price, amazon_90d_avg_price,
    amazon_180d_avg_price, amazon_new_price, amazon_used_price,
    sales_rank, category, is_amazon_in_stock, offers_count,
    keepa_confidence, raw_summary,
  } = data;

  // Upsert: prefer asin uniqueness, fall back to upc uniqueness
  const conflictCol = asin ? '(source, asin)' : '(source, upc)';

  const r = await query(`
    INSERT INTO product_market_data (
      product_id, upc, asin, source, title, brand, image_url,
      amazon_current_price, amazon_buy_box_price, amazon_90d_avg_price, amazon_180d_avg_price,
      amazon_new_price, amazon_used_price, sales_rank, category,
      is_amazon_in_stock, offers_count, keepa_confidence, raw_summary,
      fetched_at, updated_at
    ) VALUES ($1,$2,$3,'keepa',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
    ON CONFLICT ${conflictCol} DO UPDATE SET
      product_id = EXCLUDED.product_id,
      upc = EXCLUDED.upc,
      title = EXCLUDED.title, brand = EXCLUDED.brand, image_url = EXCLUDED.image_url,
      amazon_current_price = EXCLUDED.amazon_current_price,
      amazon_buy_box_price = EXCLUDED.amazon_buy_box_price,
      amazon_90d_avg_price = EXCLUDED.amazon_90d_avg_price,
      amazon_180d_avg_price = EXCLUDED.amazon_180d_avg_price,
      amazon_new_price = EXCLUDED.amazon_new_price,
      amazon_used_price = EXCLUDED.amazon_used_price,
      sales_rank = EXCLUDED.sales_rank, category = EXCLUDED.category,
      is_amazon_in_stock = EXCLUDED.is_amazon_in_stock,
      offers_count = EXCLUDED.offers_count,
      keepa_confidence = EXCLUDED.keepa_confidence,
      raw_summary = EXCLUDED.raw_summary,
      fetched_at = NOW(), updated_at = NOW()
    RETURNING *
  `, [
    productId || null, upc || null, asin || null, title || null, brand || null, image_url || null,
    amazon_current_price || null, amazon_buy_box_price || null, amazon_90d_avg_price || null,
    amazon_180d_avg_price || null, amazon_new_price || null, amazon_used_price || null,
    sales_rank || null, category || null, is_amazon_in_stock ?? null, offers_count || null,
    keepa_confidence || 0, raw_summary ? JSON.stringify(raw_summary) : '{}',
  ]);
  return r.rows[0];
}

async function lookupByAsin(asin, options = {}) {
  if (!isEnabled()) return { configured: false, error: 'Keepa API not configured' };
  if (!asin) return { configured: true, found: false, error: 'No ASIN provided' };

  try {
    if (!options.skipCache) {
      const cached = await getCachedMarketData({ asin });
      if (cached) {
        logger.info(`[Keepa] cache hit for ASIN ${asin}`);
        return { ...formatCachedRow(cached), cached: true };
      }
    }

    const data = await callKeepaApi({ asin });
    const product = data.products[0];
    if (!product) return { configured: true, found: false, error: 'No Keepa product found for ASIN' };

    const parsed = parseKeepaProduct(product, null);
    const saved = await saveKeepaMarketData(options.productId || null, parsed);
    return { ...formatRow(saved, parsed), cached: false, source: 'keepa', configured: true, found: true };
  } catch (err) {
    logger.error(`[Keepa] lookupByAsin error: ${err.message}`);
    return { configured: true, found: false, error: err.message };
  }
}

async function lookupByCode({ upc, ean, sku, title, brand } = {}, options = {}) {
  if (!isEnabled()) return { configured: false, error: 'Keepa API not configured' };

  const code = upc || ean || sku;
  if (!code) return { configured: true, found: false, error: 'No code provided (upc/ean/sku)' };

  try {
    if (!options.skipCache) {
      const cached = await getCachedMarketData({ upc: code });
      if (cached) {
        logger.info(`[Keepa] cache hit for code ${code}`);
        return { ...formatCachedRow(cached), cached: true };
      }
    }

    const data = await callKeepaApi({ code });
    if (!data.products.length) {
      logger.info(`[Keepa] no match for code ${code}`);
      return { configured: true, found: false, error: 'No Keepa product found' };
    }

    const product = data.products[0];
    const parsed = parseKeepaProduct(product, code);
    const saved = await saveKeepaMarketData(options.productId || null, parsed);
    return { ...formatRow(saved, parsed), cached: false, source: 'keepa', configured: true, found: true };
  } catch (err) {
    logger.error(`[Keepa] lookupByCode error (code=${code}): ${err.message}`);
    return { configured: true, found: false, error: err.message };
  }
}

async function enrichProductWithKeepa(product, options = {}) {
  if (!isEnabled()) return { configured: false, error: 'Keepa API not configured' };

  const { id: productId, upc, sku, name, brand } = product;

  // Try by UPC first
  if (upc) {
    const result = await lookupByCode({ upc }, { ...options, productId });
    if (result.found) return result;
  }

  // Try by SKU if no UPC match
  if (sku && !upc) {
    const result = await lookupByCode({ sku }, { ...options, productId });
    if (result.found) return result;
  }

  return { configured: true, found: false, error: 'No matching Keepa product found for product' };
}

function formatRow(row, parsed) {
  if (!row) return parsed;
  return {
    configured: true,
    found: true,
    source: 'keepa',
    asin: row.asin,
    upc: row.upc,
    title: row.title,
    brand: row.brand,
    image_url: row.image_url,
    amazon_current_price: row.amazon_current_price ? parseFloat(row.amazon_current_price) : null,
    amazon_buy_box_price: row.amazon_buy_box_price ? parseFloat(row.amazon_buy_box_price) : null,
    amazon_90d_avg_price: row.amazon_90d_avg_price ? parseFloat(row.amazon_90d_avg_price) : null,
    amazon_180d_avg_price: row.amazon_180d_avg_price ? parseFloat(row.amazon_180d_avg_price) : null,
    amazon_new_price: row.amazon_new_price ? parseFloat(row.amazon_new_price) : null,
    amazon_used_price: row.amazon_used_price ? parseFloat(row.amazon_used_price) : null,
    sales_rank: row.sales_rank ? parseInt(row.sales_rank) : null,
    category: row.category,
    is_amazon_in_stock: row.is_amazon_in_stock,
    offers_count: row.offers_count ? parseInt(row.offers_count) : null,
    confidence: row.keepa_confidence ? parseInt(row.keepa_confidence) : 0,
    fetched_at: row.fetched_at,
  };
}

function formatCachedRow(row) {
  return formatRow(row, {});
}

module.exports = {
  lookupByAsin,
  lookupByCode,
  enrichProductWithKeepa,
  getCachedMarketData,
  saveKeepaMarketData,
  isEnabled,
};

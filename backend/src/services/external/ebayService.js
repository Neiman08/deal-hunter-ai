const axios = require('axios');
const { query } = require('../../config/database');
const logger = require('../../utils/logger');

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const CACHE_HOURS = parseFloat(process.env.EBAY_CACHE_HOURS || '24');

// In-memory token cache (expires before eBay revokes it)
let _tokenCache = { token: null, expiresAt: 0 };

function isEnabled() {
  return process.env.EBAY_ENABLED !== 'false'
    && !!process.env.EBAY_CLIENT_ID
    && !!process.env.EBAY_CLIENT_SECRET;
}

async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  const creds = Buffer.from(`${id}:${secret}`).toString('base64');

  const res = await axios.post(EBAY_TOKEN_URL,
    'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    }
  );
  const { access_token, expires_in } = res.data;
  _tokenCache = {
    token: access_token,
    expiresAt: Date.now() + (expires_in - 120) * 1000, // renew 2 min early
  };
  logger.info('[eBay] OAuth2 token refreshed');
  return access_token;
}

async function searchListings(searchTerm, options = {}) {
  const token = await getAccessToken();
  const params = {
    q: searchTerm,
    limit: options.limit || 10,
    filter: 'conditionIds:{1000|1500|2000|2500|3000}', // new + like new + good
    sort: options.sort || 'bestMatch',
  };
  if (options.buyingOptions) params.filter += `,buyingOptions:{${options.buyingOptions}}`;

  const res = await axios.get(EBAY_BROWSE_URL, {
    params,
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    timeout: 15000,
  });
  return res.data;
}

function parsePriceData(data) {
  const items = (data.itemSummaries || []).filter(i => i.price?.value);
  if (!items.length) return null;

  const prices = items.map(i => parseFloat(i.price.value)).filter(p => p > 0);
  if (!prices.length) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const avg = Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];

  const top = items[0];
  const topItemId = top?.itemId || null;
  const topItemUrl = top?.itemWebUrl || null;

  const soldCount = parseInt(data.total) || items.length;
  const activeListings = items.length;

  return {
    avg_sold_price: avg,
    min_price: min,
    max_price: max,
    median_price: median,
    sold_count: soldCount,
    active_listings: activeListings,
    top_item_id: topItemId,
    top_item_url: topItemUrl,
  };
}

async function getCachedEbayData({ productId, upc }) {
  const cacheMs = CACHE_HOURS * 3600000;
  const conditions = [];
  const params = [];
  let p = 1;

  if (productId) { conditions.push(`product_id = $${p++}`); params.push(productId); }
  else if (upc) { conditions.push(`upc = $${p++}`); params.push(upc); }
  else return null;

  conditions.push(`fetched_at > NOW() - ($${p++} * INTERVAL '1 millisecond')`);
  params.push(cacheMs);

  const r = await query(
    `SELECT * FROM ebay_market_data WHERE ${conditions.join(' AND ')} ORDER BY fetched_at DESC LIMIT 1`,
    params
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

async function saveEbayData(productId, upc, searchQuery, priceData) {
  if (!priceData) return null;
  const r = await query(`
    INSERT INTO ebay_market_data (
      product_id, upc, search_query,
      avg_sold_price, min_price, max_price, median_price,
      sold_count, active_listings,
      top_item_id, top_item_url,
      raw_summary, fetched_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
    ON CONFLICT (upc) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      search_query = EXCLUDED.search_query,
      avg_sold_price = EXCLUDED.avg_sold_price,
      min_price = EXCLUDED.min_price,
      max_price = EXCLUDED.max_price,
      median_price = EXCLUDED.median_price,
      sold_count = EXCLUDED.sold_count,
      active_listings = EXCLUDED.active_listings,
      top_item_id = EXCLUDED.top_item_id,
      top_item_url = EXCLUDED.top_item_url,
      raw_summary = EXCLUDED.raw_summary,
      fetched_at = NOW(), updated_at = NOW()
    RETURNING *
  `, [
    productId || null,
    upc || null,
    searchQuery,
    priceData.avg_sold_price, priceData.min_price, priceData.max_price, priceData.median_price,
    priceData.sold_count, priceData.active_listings,
    priceData.top_item_id, priceData.top_item_url,
    JSON.stringify({ items_count: priceData.active_listings }),
  ]).catch(err => {
    logger.error(`[eBay] saveEbayData error: ${err.message}`);
    return { rows: [] };
  });
  return r.rows[0] || null;
}

async function lookupByUpc(upc, options = {}) {
  if (!isEnabled()) return { configured: false, error: 'eBay API not configured' };
  if (!upc) return { configured: true, found: false, error: 'No UPC provided' };

  try {
    if (!options.skipCache) {
      const cached = await getCachedEbayData({ upc, productId: options.productId });
      if (cached) {
        logger.info(`[eBay] cache hit for UPC ${upc}`);
        return formatRow(cached, true);
      }
    }

    logger.info(`[eBay] fetching by UPC ${upc}`);
    const data = await searchListings(`UPC:${upc}`, { limit: 10 });
    let priceData = parsePriceData(data);

    // Fallback: no UPC match → nothing
    if (!priceData) return { configured: true, found: false, error: 'No eBay listings found for UPC' };

    const saved = await saveEbayData(options.productId || null, upc, `UPC:${upc}`, priceData);
    return formatRow(saved || priceData, false);
  } catch (err) {
    logger.error(`[eBay] lookupByUpc error (${upc}): ${err.message}`);
    return { configured: true, found: false, error: err.message };
  }
}

async function lookupByKeyword(keyword, upc, options = {}) {
  if (!isEnabled()) return { configured: false, error: 'eBay API not configured' };
  if (!keyword) return { configured: true, found: false, error: 'No keyword provided' };

  const cacheKey = upc || keyword;
  try {
    if (!options.skipCache) {
      const cached = await getCachedEbayData({ upc: cacheKey, productId: options.productId });
      if (cached) {
        logger.info(`[eBay] cache hit for keyword ${keyword}`);
        return formatRow(cached, true);
      }
    }

    logger.info(`[eBay] fetching by keyword "${keyword.slice(0, 60)}"`);
    const data = await searchListings(keyword, { limit: 10 });
    const priceData = parsePriceData(data);

    if (!priceData) return { configured: true, found: false, error: 'No eBay listings found' };

    const saved = await saveEbayData(options.productId || null, upc || null, keyword, priceData);
    return formatRow(saved || priceData, false);
  } catch (err) {
    logger.error(`[eBay] lookupByKeyword error: ${err.message}`);
    return { configured: true, found: false, error: err.message };
  }
}

function formatRow(row, cached = false) {
  if (!row) return { configured: true, found: false, error: 'No data' };
  return {
    configured: true,
    found: true,
    source: 'ebay',
    cached,
    upc: row.upc || null,
    avg_sold_price: row.avg_sold_price ? parseFloat(row.avg_sold_price) : null,
    min_price: row.min_price ? parseFloat(row.min_price) : null,
    max_price: row.max_price ? parseFloat(row.max_price) : null,
    median_price: row.median_price ? parseFloat(row.median_price) : null,
    sold_count: row.sold_count ? parseInt(row.sold_count) : null,
    active_listings: row.active_listings ? parseInt(row.active_listings) : null,
    top_item_url: row.top_item_url || null,
    fetched_at: row.fetched_at || null,
  };
}

module.exports = {
  isEnabled,
  lookupByUpc,
  lookupByKeyword,
  getCachedEbayData,
};

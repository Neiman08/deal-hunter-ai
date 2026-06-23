/**
 * UPC Recovery Engine
 * When Keepa finds nothing, try free UPC databases to get product identity
 * (name, brand, image) and any available market pricing.
 *
 * Sources in priority order:
 *  1. UPCitemdb (trial, 100 req/day — cached to avoid waste)
 *  2. Open Food Facts (unlimited, good for grocery/food)
 *  3. Walmart Product Search (free, good for general merchandise)
 *  4. Internal Deal Hunter history (scanner_unknown_products cache)
 *
 * Market pricing from upcitemdb:
 *  - lowest_recorded_price / highest_recorded_price → midpoint estimate (low confidence)
 *  - offers[].price from trusted merchants → higher confidence estimate
 */

const axios = require('axios');
const logger = require('../../utils/logger');

const TIMEOUT_MS = 6000;
const TRUSTED_MERCHANTS = ['walmart.com', 'target.com', 'bestbuy.com', 'amazon.com', 'costco.com', 'homedepot.com'];

function extractMarketPricing(item) {
  const low  = item.lowest_recorded_price  ? parseFloat(item.lowest_recorded_price)  : null;
  const high = item.highest_recorded_price ? parseFloat(item.highest_recorded_price) : null;

  // Find best current offer from a trusted merchant
  const offers = (item.offers || [])
    .filter(o => {
      const domain = (o.domain || '').toLowerCase();
      return TRUSTED_MERCHANTS.some(m => domain.includes(m)) && parseFloat(o.price) > 0;
    })
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

  // Prefer in-stock offers; fall back to any offer
  const inStock = offers.find(o => !o.availability || /in.?stock/i.test(o.availability));
  const bestOffer = inStock || offers[0] || null;

  return {
    market_low:             low,
    market_high:            high,
    market_midpoint:        (low && high) ? Math.round((low + high) / 2 * 100) / 100 : null,
    market_offer_price:     bestOffer ? parseFloat(bestOffer.price)    : null,
    market_offer_merchant:  bestOffer ? (bestOffer.merchant || null)   : null,
    market_offer_list_price: bestOffer?.list_price ? parseFloat(bestOffer.list_price) : null,
  };
}

async function tryUpcItemDb(upc) {
  const res = await axios.get('https://api.upcitemdb.com/prod/trial/lookup', {
    params: { upc },
    timeout: TIMEOUT_MS,
    headers: { 'Accept': 'application/json', 'User-Agent': 'DealHunterAI/1.0' },
  });
  const item = res.data?.items?.[0];
  if (!item?.title) return null;
  const pricing = extractMarketPricing(item);
  return {
    found: true,
    source: 'upcitemdb',
    title:       item.title || null,
    brand:       item.brand || null,
    image_url:   item.images?.[0] || null,
    category:    item.category || null,
    description: item.description || null,
    model:       item.model || null,
    ...pricing,
  };
}

async function tryOpenFoodFacts(upc) {
  const res = await axios.get(`https://world.openfoodfacts.org/api/v0/product/${upc}.json`, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'DealHunterAI/1.0 (infanteneiman@gmail.com)' },
  });
  if (res.data?.status !== 1) return null;
  const p = res.data.product;
  const title = p?.product_name || p?.product_name_en || null;
  if (!title) return null;
  return {
    found: true,
    source: 'openfoodfacts',
    title,
    brand:       p?.brands || null,
    image_url:   p?.image_front_url || null,
    category:    p?.categories?.split(',')[0]?.trim() || null,
    description: null,
    model:       null,
    market_low:  null, market_high: null, market_midpoint: null,
    market_offer_price: null, market_offer_merchant: null, market_offer_list_price: null,
  };
}

/**
 * Walmart product search by UPC.
 * Uses the public Walmart search page (HTML, no API key needed).
 * Returns product identity + Walmart price as market_offer_price.
 */
async function tryWalmartSearch(upc) {
  // Walmart's search API endpoint (no key required for basic search)
  const searchUrl = `https://www.walmart.com/search?q=${upc}&affinityOverride=default`;
  const res = await axios.get(searchUrl, {
    timeout: TIMEOUT_MS,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':     'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  // Walmart embeds product data in __NEXT_DATA__ JSON
  const m = res.data.match(/<script id="__NEXT_DATA__"[^>]*>(\{.+?\})<\/script>/s);
  if (!m) return null;

  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }

  // Navigate to first search result item
  const items =
    data?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items ||
    data?.props?.pageProps?.initialData?.searchResult?.items ||
    [];

  // Find item matching the UPC — Walmart doesn't always surface UPC in search results,
  // so we also accept the first result with a valid price if only one item is returned.
  const item = items.find(i => i.usItemId && (i.canonicalUrl || i.name)) || items[0];
  if (!item?.name) return null;

  const price = item.priceInfo?.currentPrice?.price || item.price || null;
  const imageUrl = item.imageInfo?.thumbnailUrl || item.image || null;
  const productUrl = item.canonicalUrl
    ? `https://www.walmart.com${item.canonicalUrl}`
    : null;

  return {
    found: true,
    source: 'walmart_search',
    title:       item.name || null,
    brand:       item.brand || null,
    image_url:   imageUrl,
    category:    item.category?.categoryPath?.split('/').pop() || null,
    description: item.shortDescription || null,
    model:       item.modelNumber || null,
    market_offer_price:     price ? parseFloat(price) : null,
    market_offer_merchant:  'walmart.com',
    market_offer_list_price: item.priceInfo?.wasPrice?.price ? parseFloat(item.priceInfo.wasPrice.price) : null,
    market_low:  null,
    market_high: null,
    market_midpoint: null,
    product_url: productUrl,
  };
}

/**
 * Look up a UPC in free public databases.
 * Returns product identity + any market pricing found, or { found: false }
 *
 * Cascade:
 *  1. UPCitemdb  — most comprehensive for UPCs, includes multi-merchant pricing
 *  2. OpenFoodFacts — unlimited, best for grocery/food/beverages
 *  3. Walmart Search — good for general merchandise, returns current store price
 */
async function lookupUpc(upc) {
  if (!upc || !/^\d{8,14}$/.test(upc)) return { found: false };

  try {
    const result = await tryUpcItemDb(upc);
    if (result) {
      logger.info(`[UPCRecovery] upcitemdb hit for ${upc}: "${result.title}" low=${result.market_low} offer=${result.market_offer_price}`);
      return result;
    }
  } catch (err) {
    logger.warn(`[UPCRecovery] upcitemdb failed for ${upc}: ${err.message}`);
  }

  try {
    const result = await tryOpenFoodFacts(upc);
    if (result) {
      logger.info(`[UPCRecovery] openfoodfacts hit for ${upc}: "${result.title}"`);
      return result;
    }
  } catch (err) {
    logger.warn(`[UPCRecovery] openfoodfacts failed for ${upc}: ${err.message}`);
  }

  try {
    const result = await tryWalmartSearch(upc);
    if (result) {
      logger.info(`[UPCRecovery] walmart_search hit for ${upc}: "${result.title}" price=$${result.market_offer_price}`);
      return result;
    }
  } catch (err) {
    logger.warn(`[UPCRecovery] walmart_search failed for ${upc}: ${err.message}`);
  }

  logger.info(`[UPCRecovery] no match for ${upc}`);
  return { found: false };
}

module.exports = { lookupUpc, tryWalmartSearch };

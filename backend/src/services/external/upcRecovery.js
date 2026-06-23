/**
 * UPC Recovery Engine
 * When Keepa finds nothing, try free UPC databases to get product identity
 * (name, brand, image) and any available market pricing.
 *
 * Sources in priority order:
 *  1. UPCitemdb (trial, 100 req/day — cached to avoid waste)
 *  2. Open Food Facts (unlimited, good for grocery/food)
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
 * Look up a UPC in free public databases.
 * Returns product identity + any market pricing found, or { found: false }
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

  logger.info(`[UPCRecovery] no match for ${upc}`);
  return { found: false };
}

module.exports = { lookupUpc };

/**
 * UPC Recovery Engine
 * When Keepa finds nothing, try free UPC databases to get product identity
 * (name, brand, image) even without pricing data.
 *
 * Sources in priority order:
 *  1. UPCitemdb (trial, 100 req/day — caches results to avoid waste)
 *  2. Open Food Facts (unlimited, good for grocery/food)
 */

const axios = require('axios');
const logger = require('../../utils/logger');

const TIMEOUT_MS = 6000;

async function tryUpcItemDb(upc) {
  const res = await axios.get('https://api.upcitemdb.com/prod/trial/lookup', {
    params: { upc },
    timeout: TIMEOUT_MS,
    headers: { 'Accept': 'application/json', 'User-Agent': 'DealHunterAI/1.0' },
  });
  const item = res.data?.items?.[0];
  if (!item?.title) return null;
  return {
    found: true,
    source: 'upcitemdb',
    title: item.title || null,
    brand: item.brand || null,
    image_url: item.images?.[0] || null,
    category: item.category || null,
    description: item.description || null,
    model: item.model || null,
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
    brand: p?.brands || null,
    image_url: p?.image_front_url || null,
    category: p?.categories?.split(',')[0]?.trim() || null,
    description: null,
    model: null,
  };
}

/**
 * Look up a UPC in free public databases.
 * Returns { found, source, title, brand, image_url, category } or { found: false }
 */
async function lookupUpc(upc) {
  if (!upc || !/^\d{8,14}$/.test(upc)) return { found: false };

  try {
    const result = await tryUpcItemDb(upc);
    if (result) {
      logger.info(`[UPCRecovery] upcitemdb hit for ${upc}: "${result.title}"`);
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

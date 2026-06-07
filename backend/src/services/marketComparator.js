/**
 * Market Comparator — Multi-platform resale price aggregator
 * Platforms: Amazon, eBay, Facebook Marketplace, Mercari, OfferUp
 *
 * Uses a mix of:
 * - Official APIs (eBay Browse API)
 * - Public JSON endpoints
 * - Heuristic models (when APIs unavailable)
 *
 * All data is cached in DB to avoid rate limits.
 */

const axios = require('axios');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Fee structures (2025 rates) ─────────────────────────────────────────────
const PLATFORM_FEES = {
  amazon: { finalValueFee: 0.15, fixedFee: 0.99, prepFee: 3.22, shipping: 0, note: 'FBA fulfilled by Amazon' },
  ebay: { finalValueFee: 0.1325, fixedFee: 0.30, shipping: 12, note: 'Standard shipping included' },
  mercari: { finalValueFee: 0.10, fixedFee: 0, shipping: 8, note: 'Mercari pays shipping' },
  offerup: { finalValueFee: 0.099, fixedFee: 0, shipping: 7, note: 'TruYou fee' },
  facebook: { finalValueFee: 0.05, fixedFee: 0, shipping: 0, note: 'Local pickup, no shipping' },
};

// ─── Brand/category resale multipliers (vs MSRP) ─────────────────────────────
const RESALE_MULTIPLIERS = {
  // Power Tools
  dewalt: { amazon: 0.82, ebay: 0.78, mercari: 0.72, offerup: 0.65, facebook: 0.70 },
  milwaukee: { amazon: 0.86, ebay: 0.83, mercari: 0.76, offerup: 0.69, facebook: 0.73 },
  makita: { amazon: 0.78, ebay: 0.74, mercari: 0.68, offerup: 0.62, facebook: 0.66 },
  ryobi: { amazon: 0.65, ebay: 0.60, mercari: 0.55, offerup: 0.50, facebook: 0.55 },
  // Appliances
  dyson: { amazon: 0.80, ebay: 0.75, mercari: 0.70, offerup: 0.65, facebook: 0.68 },
  shark: { amazon: 0.68, ebay: 0.62, mercari: 0.58, offerup: 0.52, facebook: 0.55 },
  roomba: { amazon: 0.72, ebay: 0.68, mercari: 0.64, offerup: 0.58, facebook: 0.60 },
  kitchenaid: { amazon: 0.76, ebay: 0.72, mercari: 0.66, offerup: 0.60, facebook: 0.65 },
  // Electronics
  apple: { amazon: 0.88, ebay: 0.85, mercari: 0.80, offerup: 0.75, facebook: 0.78 },
  samsung: { amazon: 0.75, ebay: 0.70, mercari: 0.65, offerup: 0.60, facebook: 0.63 },
  sony: { amazon: 0.72, ebay: 0.68, mercari: 0.63, offerup: 0.58, facebook: 0.61 },
  lg: { amazon: 0.68, ebay: 0.64, mercari: 0.60, offerup: 0.55, facebook: 0.58 },
  default: { amazon: 0.68, ebay: 0.63, mercari: 0.58, offerup: 0.52, facebook: 0.55 },
};

// ─── Sales velocity by category (days to sell) ───────────────────────────────
const SALES_VELOCITY = {
  'power-tools': { amazon: 3, ebay: 5, mercari: 8, offerup: 10, facebook: 7, rating: 'FAST' },
  electronics: { amazon: 2, ebay: 4, mercari: 6, offerup: 9, facebook: 5, rating: 'FAST' },
  appliances: { amazon: 5, ebay: 8, mercari: 12, offerup: 14, facebook: 10, rating: 'MEDIUM' },
  kitchen: { amazon: 7, ebay: 10, mercari: 14, offerup: 18, facebook: 12, rating: 'MEDIUM' },
  outdoor: { amazon: 10, ebay: 14, mercari: 18, offerup: 22, facebook: 15, rating: 'MEDIUM' },
  clothing: { amazon: 14, ebay: 18, mercari: 12, offerup: 20, facebook: 16, rating: 'SLOW' },
  furniture: { amazon: 21, ebay: 25, mercari: 30, offerup: 14, facebook: 10, rating: 'SLOW' },
  toys: { amazon: 8, ebay: 12, mercari: 10, offerup: 15, facebook: 12, rating: 'MEDIUM' },
  default: { amazon: 10, ebay: 14, mercari: 16, offerup: 18, facebook: 12, rating: 'MEDIUM' },
};

// ─── eBay Browse API (real pricing data if key configured) ───────────────────
async function getEbayPrices(productName, upc) {
  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) return null;

  try {
    // Get OAuth token
    const tokenRes = await axios.post(
      'https://api.ebay.com/identity/v1/oauth2/token',
      'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
      {
        auth: { username: clientId, password: process.env.EBAY_CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      }
    );
    const token = tokenRes.data.access_token;

    // Search for item
    const searchQuery = upc || productName.split(' ').slice(0, 4).join(' ');
    const res = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
      params: { q: searchQuery, limit: 20, filter: 'buyingOptions:{FIXED_PRICE}' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });

    const items = res.data?.itemSummaries || [];
    if (!items.length) return null;

    const prices = items.map(i => parseFloat(i.price?.value || 0)).filter(p => p > 0);
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      count: prices.length,
      source: 'ebay_api',
    };
  } catch {
    return null;
  }
}

/**
 * Main comparison function — returns pricing data for all 5 platforms
 */
async function compareMarkets(productName, brand, regularPrice, categorySlug, upc = null) {
  // Check DB cache (6-hour TTL)
  if (upc) {
    const cached = await query(`
      SELECT * FROM market_comparisons
      WHERE upc = $1 AND created_at > NOW() - INTERVAL '6 hours'
      ORDER BY created_at DESC LIMIT 1
    `, [upc]);
    if (cached.rows[0]) return JSON.parse(cached.rows[0].data);
  }

  await sleep(500); // Small delay

  // Determine brand multipliers
  const brandKey = (brand || '').toLowerCase().replace(/[^a-z]/g, '');
  const mults = RESALE_MULTIPLIERS[brandKey] || RESALE_MULTIPLIERS.default;
  const velocity = SALES_VELOCITY[categorySlug] || SALES_VELOCITY.default;

  // Try eBay API for real data
  const ebayReal = await getEbayPrices(productName, upc);

  // Build platform data
  const platforms = {};

  for (const [platform, fees] of Object.entries(PLATFORM_FEES)) {
    const resalePrice = platform === 'ebay' && ebayReal
      ? ebayReal.avg
      : Math.round(regularPrice * mults[platform]);

    const grossProfit = resalePrice - fees.finalValueFee * resalePrice - fees.fixedFee
      - (fees.shipping || 0) - (fees.prepFee || 0);
    const netProfit = Math.round(grossProfit); // before sourcing cost

    const daysToSell = velocity[platform];
    const demandScore = Math.max(0, Math.min(100, Math.round(100 - daysToSell * 4)));

    platforms[platform] = {
      platform,
      display_name: { amazon: 'Amazon FBA', ebay: 'eBay', mercari: 'Mercari', offerup: 'OfferUp', facebook: 'FB Marketplace' }[platform],
      resale_price: resalePrice,
      min_price: Math.round(resalePrice * 0.85),
      max_price: Math.round(resalePrice * 1.15),
      gross_profit: Math.round(grossProfit + fees.shipping), // before buy cost
      fees: {
        percentage: Math.round(fees.finalValueFee * 100 * 10) / 10,
        fixed: fees.fixedFee,
        shipping: fees.shipping || 0,
        total: Math.round(resalePrice * fees.finalValueFee + fees.fixedFee + (fees.shipping || 0)),
      },
      days_to_sell: daysToSell,
      demand_score: demandScore,
      demand_label: demandScore >= 75 ? 'Very High' : demandScore >= 50 ? 'High' : demandScore >= 25 ? 'Medium' : 'Low',
      data_source: platform === 'ebay' && ebayReal ? 'real_time' : 'model',
      notes: fees.note,
    };
  }

  // Aggregate stats
  const prices = Object.values(platforms).map(p => p.resale_price);
  const profits = Object.values(platforms).map(p => p.gross_profit);
  const bestPlatform = Object.values(platforms).sort((a, b) => b.gross_profit - a.gross_profit)[0];

  const result = {
    platforms,
    summary: {
      price_min: Math.min(...prices),
      price_avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      price_max: Math.max(...prices),
      best_platform: bestPlatform.platform,
      best_platform_name: bestPlatform.display_name,
      best_gross_profit: bestPlatform.gross_profit,
      demand_rating: velocity.rating,
      fastest_platform: Object.values(platforms).sort((a, b) => a.days_to_sell - b.days_to_sell)[0].platform,
    },
    generated_at: new Date().toISOString(),
  };

  // Cache in DB
  if (upc) {
    await query(`
      INSERT INTO market_comparisons (upc, product_name, data, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (upc) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()
    `, [upc, productName, JSON.stringify(result)]).catch(() => {});
  }

  return result;
}

module.exports = { compareMarkets, PLATFORM_FEES, SALES_VELOCITY, RESALE_MULTIPLIERS };

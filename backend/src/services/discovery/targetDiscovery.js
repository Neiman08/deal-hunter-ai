/**
 * Target Discovery — Redsky API (HTTP, no browser)
 *
 * Uses Target's internal plp_search_v2 endpoint to collect TCINs +
 * prices, then saves directly to DB via saveProductData.
 * No Playwright needed → no anti-bot exposure during discovery.
 *
 * Product page browser-scraping is preserved in scrapers/target.js for
 * individual re-scans; this module bypasses it entirely for bulk discovery.
 */

const https            = require('https');
const { query }           = require('../../config/database');
const { buildHttpProxyAgent } = require('../../utils/proxyUtils');
const { saveProductData } = require('../scraperBase');
const { isStopRequested } = require('../discoveryLock');
const logger              = require('../../utils/logger');

const STORE_SLUG  = 'target';
const STORE_LABEL = 'Target';

// Redsky aggregations endpoint — Target's own internal search API
const REDSKY_URL = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2';
// Fixed visitor_id — Target uses it for analytics only; any valid UUID works
const VISITOR_ID = '018fe9e2-a8a9-7e84-9a99-4c9d44b0de95';

// BrightData residential proxy — port/zone auto-corrected by buildHttpProxyAgent
const PROXY_HOST = process.env.PROXY_HOST || 'brd.superproxy.io';
const PROXY_PORT = parseInt(process.env.PROXY_PORT) || 22225;
const PROXY_USER = process.env.PROXY_USER || '';

console.log('[Discovery:Target] ── PROXY CONFIG ──');
console.log(`[Discovery:Target] PROXY_ENABLED    = ${process.env.PROXY_ENABLED}`);
console.log(`[Discovery:Target] PROXY_HOST       = ${PROXY_HOST}`);
console.log(`[Discovery:Target] PROXY_PORT       = ${PROXY_PORT}  (22225=residential 33335=ISP)`);
console.log(`[Discovery:Target] PROXY_USER       = ${PROXY_USER}`);
console.log(`[Discovery:Target] Proxy URL        = http://${PROXY_USER}:***@${PROXY_HOST}:${PROXY_PORT}`);

// Search terms rotated per cycle — varied to spread over categories
const SEARCH_GROUPS = [
  ['samsung tv', 'lg tv', 'oled tv', 'sony tv'],
  ['airpods', 'apple watch', 'ipad', 'macbook'],
  ['robot vacuum', 'dyson', 'roomba', 'shark vacuum'],
  ['ninja', 'keurig', 'air fryer', 'kitchenaid'],
  ['headphones', 'soundbar', 'bluetooth speaker', 'earbuds'],
  ['laptop', 'chromebook', 'hp laptop', 'dell laptop'],
  ['ps5', 'nintendo switch', 'xbox', 'gaming chair'],
  ['instant pot', 'vitamix', 'stand mixer', 'coffee maker'],
  ['dewalt', 'milwaukee tools', 'power tools', 'cordless drill'],
  ['funko pop', 'pokemon cards', 'lego', 'barbie'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── HTTP fetch helper (always via residential proxy) ─────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const agent = buildHttpProxyAgent('Target');

    const opts = {
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.target.com/',
        'Origin': 'https://www.target.com',
      },
    };
    if (agent) opts.agent = agent;

    const req = https.get(url, opts, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

// ── Redsky plp_search_v2 ────────────────────────────────────────────────────
async function searchRedsky(searchTerm, count = 24) {
  const params = new URLSearchParams({
    searchTerm,
    channel: 'WEB',
    count: String(count),
    default_purchasability_filter: 'true',
    include_sponsored: 'true',
    keyword: searchTerm,
    offset: '0',
    platform: 'desktop',
    visitor_id: VISITOR_ID,
    zip: '10001',
  });
  const url = `${REDSKY_URL}?${params.toString()}`;
  logger.info(`[Discovery:${STORE_LABEL}] Redsky: ${searchTerm}`);
  const json = await fetchJson(url);
  return json?.data?.search?.products || [];
}

// ── Parse a Redsky product item ─────────────────────────────────────────────
function parseRedskyProduct(p) {
  const tcin         = p?.tcin;
  if (!tcin) return null;

  const item         = p?.item || {};
  const price        = p?.price || {};
  const images       = item?.enrichment?.images || {};

  const name         = item?.product_description?.title || '';
  const brand        = item?.primary_brand?.name || '';
  const currentPrice = parseFloat(price.current_retail || price.formatted_current_price?.replace(/[^0-9.]/g,'') || 0);
  const regularPrice = parseFloat(price.reg_retail || 0) || null;
  const imageUrl     = images.primary_image_url || null;
  const inStock      = !(p?.fulfillment?.is_out_of_stock);
  const isClearance  = !!(price.is_clearance);

  if (!currentPrice || !name) return null;

  return {
    tcin, name, brand, currentPrice, regularPrice, imageUrl, inStock, isClearance,
    productUrl: `https://www.target.com/p/${encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,60)}/-/A-${tcin}`,
    sku: `target-${tcin}`,
  };
}

// ── Filter products already in DB ──────────────────────────────────────────
async function filterNewProducts(products) {
  if (!products.length) return [];
  const skus = products.map(p => p.sku);
  const storeRes = await query('SELECT id FROM stores WHERE slug = $1', [STORE_SLUG]);
  const storeId  = storeRes.rows[0]?.id;
  if (!storeId) return products;

  const existing = await query(
    'SELECT sku FROM products WHERE store_id = $1 AND sku = ANY($2::text[])',
    [storeId, skus]
  );
  const knownSkus = new Set(existing.rows.map(r => r.sku));
  return products.filter(p => !knownSkus.has(p.sku));
}

// ── Save a Redsky product directly to DB (no browser) ─────────────────────
async function saveRedskyProduct(p, storeId, categoryId, catSlug) {
  // Upsert product row
  const inserted = await query(`
    INSERT INTO products (name, brand, sku, store_id, category_id, image_url, product_url, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    ON CONFLICT (sku, store_id) DO UPDATE SET
      name       = EXCLUDED.name,
      brand      = COALESCE(EXCLUDED.brand, products.brand),
      image_url  = COALESCE(EXCLUDED.image_url, products.image_url),
      product_url= COALESCE(EXCLUDED.product_url, products.product_url),
      updated_at = NOW()
    RETURNING *
  `, [p.name, p.brand || null, p.sku, storeId, categoryId, p.imageUrl, p.productUrl]);

  const dbProduct = { ...inserted.rows[0], cat_slug: catSlug };

  // Save price + deal via scraperBase (same pipeline as browser scraper)
  await saveProductData(dbProduct, {
    currentPrice:  p.currentPrice,
    regularPrice:  p.regularPrice,
    inStock:       p.inStock,
    imageUrl:      p.imageUrl,
    productUrl:    p.productUrl,
    storeSlug:     STORE_SLUG,
    pageText:      p.isClearance ? 'clearance' : '',
  }, STORE_SLUG);

  return dbProduct;
}

// ── Main discovery ──────────────────────────────────────────────────────────
async function runTargetDiscovery(options = {}) {
  const maxTotal = options.maxTotal || 150;

  const stats = {
    pages_visited: 0, urls_discovered: 0, urls_new: 0,
    saved: 0, no_price: 0, errors: 0, blocked: false,
  };

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🎯 ${STORE_LABEL.toUpperCase()} DISCOVERY (Redsky API)`);
  logger.info(`   maxTotal=${maxTotal}`);
  logger.info('═'.repeat(60));

  // Rotate search group by 30-min cycle
  const cycleNum   = Math.floor(Date.now() / (30 * 60 * 1000));
  const group      = SEARCH_GROUPS[cycleNum % SEARCH_GROUPS.length];

  // Lookup store + category once
  const storeRes   = await query('SELECT id FROM stores WHERE slug = $1', [STORE_SLUG]);
  const storeId    = storeRes.rows[0]?.id;
  if (!storeId) { logger.error(`[Discovery:${STORE_LABEL}] Store not found`); return stats; }
  const catRes     = await query('SELECT id, slug FROM categories ORDER BY name LIMIT 1');
  const categoryId = catRes.rows[0]?.id || null;
  const catSlug    = catRes.rows[0]?.slug || null;

  const allProducts = [];

  for (const term of group) {
    if (isStopRequested()) break;
    if (allProducts.length >= maxTotal * 3) break;

    try {
      const raw     = await searchRedsky(term, 24);
      const parsed  = raw.map(parseRedskyProduct).filter(Boolean);
      stats.pages_visited++;
      stats.urls_discovered += parsed.length;
      allProducts.push(...parsed);
      logger.info(`[Discovery:${STORE_LABEL}] "${term}": ${parsed.length} products`);
    } catch (err) {
      logger.error(`[Discovery:${STORE_LABEL}] Redsky "${term}": ${err.message}`);
      stats.errors++;
      stats.last_error = err.message;
      // Hard block — stop trying more terms
      if (/HTTP (403|429|503)/.test(err.message)) {
        stats.blocked = true;
        break;
      }
    }

    await sleep(800);
  }

  if (!allProducts.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No products from Redsky — stopping`);
    return stats;
  }

  // Dedup against DB
  const newProducts  = await filterNewProducts(allProducts);
  stats.urls_new     = newProducts.length;
  const toProcess    = newProducts.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All products already in DB`);
    return stats;
  }

  logger.info(`[Discovery:${STORE_LABEL}] Saving ${toProcess.length} new products...`);

  for (const p of toProcess) {
    if (isStopRequested()) break;
    try {
      await saveRedskyProduct(p, storeId, categoryId, catSlug);
      stats.saved++;
      const disc = p.regularPrice ? Math.round((1 - p.currentPrice / p.regularPrice) * 100) : 0;
      logger.info(`[Discovery:${STORE_LABEL}]   ✅ "${p.name}" | $${p.currentPrice}${disc ? ` (${disc}% off $${p.regularPrice})` : ''}`);
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${p.name}: ${err.message}`);
    }
    await sleep(200);
  }

  // Final deal count
  try {
    const dealRow = await query(`
      SELECT COUNT(*) FILTER (WHERE d.is_active) AS active
      FROM deals d JOIN stores s ON s.id = d.store_id WHERE s.slug = $1
    `, [STORE_SLUG]);
    stats.active_deals = parseInt(dealRow.rows[0]?.active || 0);
  } catch {}

  logger.info('═'.repeat(60));
  logger.info(`🎯 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   searched: ${stats.pages_visited} terms | found: ${stats.urls_discovered} | new: ${stats.urls_new} | saved: ${stats.saved} | errors: ${stats.errors} | active_deals: ${stats.active_deals || 0}`);
  logger.info('═'.repeat(60) + '\n');

  return stats;
}

module.exports = { runTargetDiscovery, runDiscovery: runTargetDiscovery, SEARCH_GROUPS };

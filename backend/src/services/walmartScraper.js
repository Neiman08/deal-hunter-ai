/**
 * Walmart Scraper v3 — Full diagnostic logging, no silent failures
 *
 * Method chain (each tries, logs result, then tries next):
 *   M1: Official Affiliate API (needs WALMART_API_KEY)
 *   M2: __NEXT_DATA__ JSON from search page (public, no key needed)
 *   M3: Item product page __NEXT_DATA__ (direct item URL)
 *
 * Every failure is logged with: URL, HTTP status, reason, and what was missing.
 */

const axios = require('axios');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { analyzeOpportunity } = require('./opportunityEngine');

const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY_MS) || 2500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];
let uaIdx = 0;
const getUA = () => USER_AGENTS[uaIdx++ % USER_AGENTS.length];

const HEADERS = () => ({
  'User-Agent': getUA(),
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': 'https://www.walmart.com/',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
});

// ─── Diagnostic result builder ────────────────────────────────────────────────
function makeResult(success, data, method, diagnostics) {
  return { success, ...data, method_used: method, diagnostics };
}

// ─── Method 1: Official Walmart Affiliate API ─────────────────────────────────
async function tryOfficialAPI(upc) {
  const apiKey = process.env.WALMART_API_KEY;
  if (!apiKey) {
    return makeResult(false, {}, 'official_api', {
      skipped: true,
      reason: 'WALMART_API_KEY not set in environment',
      fix: 'Set WALMART_API_KEY in .env — get key at https://developer.walmart.com',
    });
  }

  const url = `https://api.walmartlabs.com/v1/items`;
  logger.info(`[Walmart M1] Trying Official API | UPC: ${upc} | URL: ${url}`);

  try {
    const res = await axios.get(url, {
      params: { apiKey, upc, format: 'json' },
      timeout: 8000,
    });

    logger.info(`[Walmart M1] HTTP ${res.status} | Items in response: ${res.data?.items?.length ?? 0}`);

    const item = res.data?.items?.[0];
    if (!item) {
      return makeResult(false, {}, 'official_api', {
        http_status: res.status,
        reason: 'API returned 0 items for this UPC',
        upc_searched: upc,
        response_keys: Object.keys(res.data || {}),
      });
    }

    const normalized = normalizeWalmartItem(item, 'official_api');
    if (!normalized.currentPrice) {
      return makeResult(false, {}, 'official_api', {
        http_status: res.status,
        reason: 'Product found but price fields are all null/undefined',
        price_fields_seen: { salePrice: item.salePrice, currentPrice: item.currentPrice, price: item.price },
      });
    }

    logger.info(`[Walmart M1] ✅ SUCCESS | ${normalized.name} | $${normalized.currentPrice}`);
    return makeResult(true, normalized, 'official_api', { http_status: res.status });

  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    logger.error(`[Walmart M1] FAILED | HTTP ${status ?? 'no_response'} | ${err.message}`);
    if (body) logger.error(`[Walmart M1] Response body: ${JSON.stringify(body).slice(0, 300)}`);
    return makeResult(false, {}, 'official_api', {
      http_status: status,
      error_message: err.message,
      response_body: body,
    });
  }
}

// ─── Method 2: Search page __NEXT_DATA__ extraction ──────────────────────────
async function trySearchPageNextData(upc) {
  const url = `https://www.walmart.com/search?q=${encodeURIComponent(upc)}`;
  logger.info(`[Walmart M2] Trying search page __NEXT_DATA__ | UPC: ${upc} | URL: ${url}`);

  await sleep(REQUEST_DELAY);

  try {
    const res = await axios.get(url, {
      headers: HEADERS(),
      timeout: 15000,
      maxRedirects: 5,
    });

    logger.info(`[Walmart M2] HTTP ${res.status} | Content-Type: ${res.headers['content-type']} | Body length: ${res.data?.length ?? 0}`);

    if (res.status !== 200) {
      return makeResult(false, {}, 'search_page_next_data', {
        http_status: res.status,
        reason: `Non-200 response from Walmart search`,
      });
    }

    const html = res.data;

    // Check for bot detection / redirect
    if (html.includes('robot') || html.includes('captcha') || html.includes('blocked')) {
      logger.warn(`[Walmart M2] Bot detection triggered — response contains 'robot'/'captcha'/'blocked'`);
      return makeResult(false, {}, 'search_page_next_data', {
        http_status: res.status,
        reason: 'Bot detection / CAPTCHA triggered by Walmart',
        hint: 'Walmart is blocking this IP or request. Try adding a real Walmart API key or use a proxy.',
      });
    }

    const match = html.match(/__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/s);
    if (!match) {
      logger.warn(`[Walmart M2] __NEXT_DATA__ not found in HTML response`);
      // Log a snippet to help diagnose
      const snippet = html.slice(0, 500).replace(/\n/g, ' ');
      return makeResult(false, {}, 'search_page_next_data', {
        http_status: res.status,
        reason: '__NEXT_DATA__ JSON block not found in page HTML',
        html_snippet: snippet,
        hint: 'Page structure may have changed, or Walmart returned a bot-check page',
      });
    }

    let pageData;
    try {
      pageData = JSON.parse(match[1]);
    } catch (parseErr) {
      return makeResult(false, {}, 'search_page_next_data', {
        http_status: res.status,
        reason: `Failed to parse __NEXT_DATA__ JSON: ${parseErr.message}`,
        json_snippet: match[1].slice(0, 200),
      });
    }

    // Navigate the JSON structure
    const searchResult = pageData?.props?.pageProps?.initialData?.searchResult;
    const itemStacks = searchResult?.itemStacks;
    logger.info(`[Walmart M2] itemStacks found: ${itemStacks?.length ?? 0} | searchResult keys: ${Object.keys(searchResult || {}).join(', ')}`);

    const items = itemStacks?.[0]?.items;
    if (!items?.length) {
      return makeResult(false, {}, 'search_page_next_data', {
        http_status: res.status,
        reason: 'itemStacks[0].items is empty — no products in search results',
        data_path_checked: 'props.pageProps.initialData.searchResult.itemStacks[0].items',
        itemStacks_count: itemStacks?.length,
        available_keys: Object.keys(pageData?.props?.pageProps?.initialData || {}),
      });
    }

    logger.info(`[Walmart M2] ${items.length} items found in search results`);

    // Try to find exact UPC match first, then fall back to first result
    const exactMatch = items.find(i => i.upc === upc);
    const item = exactMatch || items[0];

    if (!exactMatch) {
      logger.warn(`[Walmart M2] No exact UPC match — using first result: ${item.name?.slice(0, 60)}`);
    }

    const normalized = normalizeWalmartItem(item, 'search_page_next_data');

    if (!normalized.currentPrice) {
      logger.warn(`[Walmart M2] Product found but no price | price fields: ${JSON.stringify({ salePrice: item.salePrice, priceInfo: item.priceInfo })}`);
      return makeResult(false, {}, 'search_page_next_data', {
        http_status: res.status,
        reason: 'Product found in search results but all price fields are null',
        item_name: item.name,
        price_fields: { salePrice: item.salePrice, currentPrice: item.currentPrice, priceInfo: item.priceInfo },
      });
    }

    logger.info(`[Walmart M2] ✅ SUCCESS | ${normalized.name} | $${normalized.currentPrice} | exact_match: ${!!exactMatch}`);
    return makeResult(true, normalized, 'search_page_next_data', { http_status: res.status, exact_upc_match: !!exactMatch });

  } catch (err) {
    const status = err.response?.status;
    logger.error(`[Walmart M2] FAILED | HTTP ${status ?? 'no_response'} | ${err.message}`);
    if (err.code) logger.error(`[Walmart M2] Error code: ${err.code}`);
    return makeResult(false, {}, 'search_page_next_data', {
      http_status: status,
      error_code: err.code,
      error_message: err.message,
    });
  }
}

// ─── Method 3: Direct item page __NEXT_DATA__ ─────────────────────────────────
async function tryItemPageNextData(itemId) {
  if (!itemId) {
    return makeResult(false, {}, 'item_page_next_data', { skipped: true, reason: 'No itemId provided' });
  }

  const url = `https://www.walmart.com/ip/${itemId}`;
  logger.info(`[Walmart M3] Trying item page direct | itemId: ${itemId} | URL: ${url}`);

  await sleep(REQUEST_DELAY + 1000);

  try {
    const res = await axios.get(url, {
      headers: HEADERS(),
      timeout: 15000,
      maxRedirects: 5,
    });

    logger.info(`[Walmart M3] HTTP ${res.status} | Body length: ${res.data?.length ?? 0}`);

    const html = res.data;
    const match = html.match(/__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/s);
    if (!match) {
      return makeResult(false, {}, 'item_page_next_data', {
        http_status: res.status,
        reason: '__NEXT_DATA__ not found on item page',
      });
    }

    const pageData = JSON.parse(match[1]);
    const product = pageData?.props?.pageProps?.initialData?.data?.product;

    logger.info(`[Walmart M3] Product found in page data: ${!!product} | name: ${product?.name?.slice(0, 50)}`);

    if (!product) {
      return makeResult(false, {}, 'item_page_next_data', {
        http_status: res.status,
        reason: 'props.pageProps.initialData.data.product is null/undefined',
        available_data_keys: Object.keys(pageData?.props?.pageProps?.initialData?.data || {}),
      });
    }

    const normalized = normalizeWalmartItem(product, 'item_page_next_data');

    if (!normalized.currentPrice) {
      return makeResult(false, {}, 'item_page_next_data', {
        http_status: res.status,
        reason: 'Item page product has no price',
        price_info: product.priceInfo,
      });
    }

    logger.info(`[Walmart M3] ✅ SUCCESS | ${normalized.name} | $${normalized.currentPrice}`);
    return makeResult(true, normalized, 'item_page_next_data', { http_status: res.status });

  } catch (err) {
    const status = err.response?.status;
    logger.error(`[Walmart M3] FAILED | HTTP ${status ?? 'no_response'} | ${err.message}`);
    return makeResult(false, {}, 'item_page_next_data', {
      http_status: status,
      error_message: err.message,
    });
  }
}

// ─── Normalize any Walmart item shape into standard object ────────────────────
function normalizeWalmartItem(item, source) {
  if (!item) return { currentPrice: null };

  const price =
    item.salePrice ??
    item.currentPrice ??
    item.priceInfo?.currentPrice?.price ??
    item.priceInfo?.priceDisplayCodes?.finalPrice ??
    item.price ??
    null;

  const wasPrice =
    item.wasPrice ??
    item.msrp ??
    item.priceInfo?.wasPrice?.price ??
    item.priceInfo?.listPrice ??
    item.originalPrice ??
    null;

  const parsedPrice = price ? parseFloat(price) : null;
  const parsedWas = wasPrice ? parseFloat(wasPrice) : null;

  return {
    name: item.name || item.title || null,
    upc: item.upc || null,
    itemId: String(item.itemId || item.usItemId || ''),
    currentPrice: parsedPrice,
    regularPrice: parsedWas || (parsedPrice ? parsedPrice * 1.4 : null),
    imageUrl: item.imageInfo?.thumbnailUrl || item.thumbnailImage || item.imageUrl || null,
    productUrl: item.canonicalUrl
      ? `https://www.walmart.com${item.canonicalUrl}`
      : item.productUrl
      || (item.itemId ? `https://www.walmart.com/ip/${item.itemId}` : null),
    inStock: ['IN_STOCK', 'AVAILABLE', true, 'true'].includes(item.availabilityStatus ?? item.inStock),
    stockQty: item.stockCount ?? item.quantity ?? null,
    brand: item.brand || null,
    categoryPath: item.categoryPath || item.category || null,
    data_source: 'live',
    source,
  };
}

// ─── Public: lookup a single UPC through all methods ─────────────────────────
async function getWalmartProductByUPC(upc) {
  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`[Walmart] Starting lookup for UPC: ${upc}`);
  logger.info(`${'═'.repeat(60)}`);

  const attempts = [];

  // Method 1
  const m1 = await tryOfficialAPI(upc);
  attempts.push(m1);
  if (m1.success) return { ...m1, attempts };

  // Method 2
  const m2 = await trySearchPageNextData(upc);
  attempts.push(m2);
  if (m2.success) return { ...m2, attempts };

  // Method 3 — only if we got an itemId from M2's partial data
  const m3 = await tryItemPageNextData(null); // no itemId available without prior success
  attempts.push(m3);

  logger.error(`[Walmart] ALL METHODS FAILED for UPC: ${upc}`);
  logger.error(`[Walmart] Summary:`);
  attempts.forEach((a, i) => {
    logger.error(`  M${i + 1} (${a.method_used}): ${a.diagnostics?.reason || a.diagnostics?.error_message || 'skipped'}`);
  });

  return { success: false, attempts, method_used: 'none' };
}

// ─── Batch scan job ───────────────────────────────────────────────────────────
async function scanWalmartDeals() {
  logger.info('🛒 Iniciando escaneo Walmart v3...');

  const productsRes = await query(`
    SELECT p.id, p.upc, p.sku, p.name, p.brand, p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'walmart'
      AND p.upc IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr
        WHERE pr.product_id = p.id AND pr.recorded_at > NOW() - INTERVAL '20 minutes'
      )
    ORDER BY RANDOM()
    LIMIT 10
  `);

  logger.info(`[Walmart Scan] ${productsRes.rows.length} products to scan`);

  let dealsFound = 0, errors = 0, scanned = 0;

  for (const product of productsRes.rows) {
    logger.info(`\n[Walmart Scan] Product: "${product.name}" | UPC: ${product.upc}`);

    const result = await getWalmartProductByUPC(product.upc);

    if (!result.success || !result.currentPrice) {
      logger.error(`[Walmart Scan] SKIP "${product.name}" — no price obtained`);
      errors++;
      continue;
    }

    const regularPrice = result.regularPrice || result.currentPrice * 1.5;
    scanned++;

    // Save price history — mark as LIVE data
    await query(`
      INSERT INTO prices (product_id, regular_price, current_price, in_stock, stock_quantity, source)
      VALUES ($1, $2, $3, $4, $5, 'walmart_live')
    `, [product.id, regularPrice, result.currentPrice, result.inStock, result.stockQty]);

    // Update product metadata
    if (result.imageUrl || result.productUrl) {
      await query(`
        UPDATE products SET
          image_url = COALESCE($1, image_url),
          product_url = COALESCE($2, product_url),
          updated_at = NOW()
        WHERE id = $3
      `, [result.imageUrl, result.productUrl, product.id]);
    }

    const discountPct = ((regularPrice - result.currentPrice) / regularPrice) * 100;
    logger.info(`[Walmart Scan] "${product.name}" | $${result.currentPrice} (was $${regularPrice}) | ${discountPct.toFixed(0)}% off`);

    if (discountPct < 15) {
      logger.info(`[Walmart Scan] Not a deal (${discountPct.toFixed(0)}% < 15% threshold), skipping`);
      continue;
    }

    const analysis = await analyzeOpportunity(product, result.currentPrice, regularPrice, result.stockQty, product.cat_slug);

    // Upsert deal — mark data_source as 'live'
    await query(`
      INSERT INTO deals (
        product_id, store_id, regular_price, deal_price, discount_percent,
        resale_price_amazon, resale_price_ebay, resale_price_facebook,
        estimated_profit, opportunity_score, opportunity_label,
        stock_quantity, is_error_price, is_active, expires_at, data_source
      )
      SELECT $1, s.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true,
        NOW() + INTERVAL '48 hours', 'live'
      FROM stores WHERE slug = 'walmart'
      ON CONFLICT (product_id, store_id) DO UPDATE SET
        deal_price = EXCLUDED.deal_price,
        discount_percent = EXCLUDED.discount_percent,
        estimated_profit = EXCLUDED.estimated_profit,
        opportunity_score = EXCLUDED.opportunity_score,
        opportunity_label = EXCLUDED.opportunity_label,
        stock_quantity = EXCLUDED.stock_quantity,
        is_error_price = EXCLUDED.is_error_price,
        data_source = 'live',
        last_seen_at = NOW(),
        is_active = true
    `, [
      product.id, regularPrice, result.currentPrice, discountPct,
      analysis.resale?.amazonPrice, analysis.resale?.ebayPrice, analysis.resale?.fbPrice,
      analysis.resale?.netProfit, analysis.score, analysis.label,
      result.stockQty, analysis.isErrorPrice,
    ]);

    dealsFound++;
    logger.info(`[Walmart Scan] ✅ Deal saved: "${product.name}" score=${analysis.score}`);
  }

  logger.info(`\n[Walmart Scan] COMPLETE: ${dealsFound} deals found, ${errors} errors, ${scanned} scanned`);
  return { deals_found: dealsFound, errors, products_scanned: scanned };
}

module.exports = { scanWalmartDeals, getWalmartProductByUPC, normalizeWalmartItem };

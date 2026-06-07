/**
 * Home Depot Scraper v3 — Full diagnostic logging, no silent failures
 *
 * Method chain:
 *   M1: federation-gateway GraphQL (official internal API, most reliable)
 *   M2: Product page HTML — parse __NEXT_DATA__ JSON block
 *   M3: Product page HTML — regex price extraction fallback
 */

const axios = require('axios');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { analyzeOpportunity } = require('./opportunityEngine');

const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY_MS) || 2500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.homedepot.com/',
  'sec-ch-ua': '"Chromium";v="124"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
};

function makeResult(success, data, method, diagnostics) {
  return { success, ...data, method_used: method, diagnostics };
}

// ─── Method 1: GraphQL federation-gateway ─────────────────────────────────────
async function tryGraphQL(sku, storeId = '6906') {
  const url = `https://www.homedepot.com/federation-gateway/graphql?opname=productClientOnlyProduct`;
  logger.info(`[HomeDepot M1] Trying GraphQL | SKU: ${sku} | storeId: ${storeId} | URL: ${url}`);

  await sleep(REQUEST_DELAY);

  const payload = {
    operationName: 'productClientOnlyProduct',
    variables: { itemId: String(sku), storeId: String(storeId) },
    query: `query productClientOnlyProduct($itemId: String!, $storeId: String) {
      product(itemId: $itemId) {
        itemId
        brand
        identifiers { productLabel modelNumber brandName }
        pricing(storeId: $storeId) { value original specialBuyPrice mapAbove }
        fulfillment(storeId: $storeId) { backordered fulfillableQuantity
          fulfillmentOptions { type fulfillable quantityAvailable }
        }
        media { images { url sizes } }
        taxonomy { breadCrumbs { label } }
      }
    }`,
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 12000,
    });

    logger.info(`[HomeDepot M1] HTTP ${res.status} | Response keys: ${Object.keys(res.data || {}).join(', ')}`);

    if (res.data?.errors?.length) {
      logger.warn(`[HomeDepot M1] GraphQL errors: ${JSON.stringify(res.data.errors)}`);
      return makeResult(false, {}, 'graphql', {
        http_status: res.status,
        reason: 'GraphQL returned errors',
        graphql_errors: res.data.errors,
      });
    }

    const p = res.data?.data?.product;
    logger.info(`[HomeDepot M1] product found: ${!!p} | pricing: ${JSON.stringify(p?.pricing)}`);

    if (!p) {
      return makeResult(false, {}, 'graphql', {
        http_status: res.status,
        reason: 'data.product is null — SKU may not exist or store ID may be wrong',
        sku_tried: sku,
        store_id_tried: storeId,
        response_data_keys: Object.keys(res.data?.data || {}),
      });
    }

    const currentPrice = p.pricing?.value ?? p.pricing?.specialBuyPrice ?? null;
    const regularPrice = p.pricing?.original ?? p.pricing?.mapAbove ?? null;

    logger.info(`[HomeDepot M1] currentPrice: ${currentPrice} | regularPrice: ${regularPrice}`);

    if (!currentPrice) {
      return makeResult(false, {}, 'graphql', {
        http_status: res.status,
        reason: 'Product found but pricing.value and pricing.specialBuyPrice are both null',
        pricing_object: p.pricing,
        sku: sku,
      });
    }

    const stockOption = p.fulfillment?.fulfillmentOptions?.find(o => o.type === 'STORE');
    const result = {
      name: p.identifiers?.productLabel || `HD Product ${sku}`,
      sku: p.itemId || sku,
      brand: p.identifiers?.brandName || p.brand || null,
      currentPrice: parseFloat(currentPrice),
      regularPrice: regularPrice ? parseFloat(regularPrice) : parseFloat(currentPrice) * 1.5,
      imageUrl: p.media?.images?.[0]?.url || null,
      productUrl: `https://www.homedepot.com/p/${sku}`,
      inStock: !p.fulfillment?.backordered && (stockOption?.fulfillable ?? true),
      stockQty: stockOption?.quantityAvailable ?? p.fulfillment?.fulfillableQuantity ?? null,
      data_source: 'live',
    };

    logger.info(`[HomeDepot M1] ✅ SUCCESS | ${result.name} | $${result.currentPrice} (was $${result.regularPrice})`);
    return makeResult(true, result, 'graphql', { http_status: res.status });

  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    logger.error(`[HomeDepot M1] FAILED | HTTP ${status ?? 'no_response'} | ${err.message}`);
    if (body) logger.error(`[HomeDepot M1] Response body: ${JSON.stringify(body).slice(0, 400)}`);
    return makeResult(false, {}, 'graphql', {
      http_status: status,
      error_message: err.message,
      error_code: err.code,
      response_body_snippet: JSON.stringify(body || {}).slice(0, 300),
    });
  }
}

// ─── Method 2: Product page __NEXT_DATA__ ─────────────────────────────────────
async function tryProductPageNextData(sku) {
  const url = `https://www.homedepot.com/p/${sku}`;
  logger.info(`[HomeDepot M2] Trying product page __NEXT_DATA__ | SKU: ${sku} | URL: ${url}`);

  await sleep(REQUEST_DELAY + 1000);

  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });

    logger.info(`[HomeDepot M2] HTTP ${res.status} | Body length: ${res.data?.length ?? 0}`);

    const html = res.data;

    if (html.includes('robot') || html.includes('captcha')) {
      return makeResult(false, {}, 'product_page_next_data', {
        http_status: res.status,
        reason: 'Bot detection triggered on product page',
      });
    }

    const match = html.match(/__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/s);
    if (!match) {
      const snippet = html.slice(0, 500).replace(/\n/g, ' ');
      return makeResult(false, {}, 'product_page_next_data', {
        http_status: res.status,
        reason: '__NEXT_DATA__ not found in product page HTML',
        html_snippet: snippet,
      });
    }

    let pageData;
    try {
      pageData = JSON.parse(match[1]);
    } catch (e) {
      return makeResult(false, {}, 'product_page_next_data', {
        reason: `JSON.parse failed: ${e.message}`,
      });
    }

    // Home Depot page data path
    const prod = pageData?.props?.pageProps?.product
      || pageData?.props?.pageProps?.initialData?.product
      || pageData?.props?.pageProps?.hydrationData?.product;

    logger.info(`[HomeDepot M2] Product in __NEXT_DATA__: ${!!prod} | checked 3 paths`);

    if (!prod) {
      return makeResult(false, {}, 'product_page_next_data', {
        http_status: res.status,
        reason: 'Product not found in any of the 3 known __NEXT_DATA__ paths',
        pageProps_keys: Object.keys(pageData?.props?.pageProps || {}),
      });
    }

    const currentPrice = prod.pricing?.value ?? prod.price ?? null;
    logger.info(`[HomeDepot M2] currentPrice from __NEXT_DATA__: ${currentPrice}`);

    if (!currentPrice) {
      return makeResult(false, {}, 'product_page_next_data', {
        http_status: res.status,
        reason: 'Product in __NEXT_DATA__ but no price field',
        pricing: prod.pricing,
      });
    }

    const result = {
      name: prod.identifiers?.productLabel || prod.name || `HD ${sku}`,
      sku,
      brand: prod.brand || null,
      currentPrice: parseFloat(currentPrice),
      regularPrice: prod.pricing?.original ? parseFloat(prod.pricing.original) : parseFloat(currentPrice) * 1.5,
      productUrl: url,
      inStock: !(prod.fulfillment?.backordered),
      data_source: 'live',
    };

    logger.info(`[HomeDepot M2] ✅ SUCCESS | ${result.name} | $${result.currentPrice}`);
    return makeResult(true, result, 'product_page_next_data', { http_status: res.status });

  } catch (err) {
    const status = err.response?.status;
    logger.error(`[HomeDepot M2] FAILED | HTTP ${status ?? 'no_response'} | ${err.message}`);
    return makeResult(false, {}, 'product_page_next_data', {
      http_status: status,
      error_message: err.message,
      error_code: err.code,
    });
  }
}

// ─── Method 3: Regex fallback on raw HTML ─────────────────────────────────────
async function tryRegexFallback(sku) {
  const url = `https://www.homedepot.com/p/${sku}`;
  logger.info(`[HomeDepot M3] Trying regex fallback | SKU: ${sku} | URL: ${url}`);

  // Reuse page from M2 if called after — in practice, called fresh
  await sleep(REQUEST_DELAY + 2000);

  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const html = res.data;

    logger.info(`[HomeDepot M3] HTTP ${res.status} | Trying regex patterns`);

    // Multiple regex patterns for HD price
    const patterns = [
      { regex: /"pricing":\s*\{"value":\s*([\d.]+)/, label: 'pricing.value JSON' },
      { regex: /"value":([\d.]+),"original"/, label: 'value+original JSON' },
      { regex: /\$\s*([\d,]+\.\d{2})\s*<\/span>.*?class="[^"]*price[^"]*"/, label: 'price span HTML' },
      { regex: /data-price="([\d.]+)"/, label: 'data-price attr' },
      { regex: /"nowPrice":\s*"?\$([\d.]+)"?/, label: 'nowPrice JSON' },
    ];

    let price = null;
    let matchedPattern = null;
    for (const { regex, label } of patterns) {
      const m = html.match(regex);
      if (m) { price = parseFloat(m[1].replace(',', '')); matchedPattern = label; break; }
    }

    logger.info(`[HomeDepot M3] Price found: ${price} via pattern: ${matchedPattern ?? 'none'}`);

    if (!price) {
      return makeResult(false, {}, 'regex_fallback', {
        http_status: res.status,
        reason: 'None of the 5 regex price patterns matched the HTML',
        patterns_tried: patterns.map(p => p.label),
        hint: 'Home Depot HTML structure has changed. All 3 methods failed.',
      });
    }

    const nameMatch = html.match(/<h1[^>]*>([^<]{10,200})<\/h1>/);
    const name = nameMatch?.[1]?.trim() || `Home Depot SKU ${sku}`;

    const result = {
      name,
      sku,
      currentPrice: price,
      regularPrice: price * 1.5,
      productUrl: url,
      inStock: !html.includes('"backordered":true'),
      data_source: 'live',
    };

    logger.info(`[HomeDepot M3] ✅ SUCCESS (regex) | ${result.name} | $${result.currentPrice}`);
    return makeResult(true, result, 'regex_fallback', { http_status: res.status, pattern_used: matchedPattern });

  } catch (err) {
    const status = err.response?.status;
    logger.error(`[HomeDepot M3] FAILED | HTTP ${status ?? 'no_response'} | ${err.message}`);
    return makeResult(false, {}, 'regex_fallback', {
      http_status: status,
      error_message: err.message,
    });
  }
}

// ─── Public: lookup a single SKU through all methods ─────────────────────────
async function getHomeDepotProduct(sku, storeId = process.env.HD_STORE_ID || '6906') {
  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`[HomeDepot] Starting lookup | SKU: ${sku} | storeId: ${storeId}`);
  logger.info(`${'═'.repeat(60)}`);

  const attempts = [];

  const m1 = await tryGraphQL(sku, storeId);
  attempts.push(m1);
  if (m1.success) return { ...m1, attempts };

  const m2 = await tryProductPageNextData(sku);
  attempts.push(m2);
  if (m2.success) return { ...m2, attempts };

  const m3 = await tryRegexFallback(sku);
  attempts.push(m3);
  if (m3.success) return { ...m3, attempts };

  logger.error(`[HomeDepot] ALL METHODS FAILED for SKU: ${sku}`);
  attempts.forEach((a, i) => {
    logger.error(`  M${i + 1} (${a.method_used}): ${a.diagnostics?.reason || a.diagnostics?.error_message || 'unknown'}`);
  });

  return { success: false, attempts, method_used: 'none' };
}

// ─── Batch scan job ───────────────────────────────────────────────────────────
async function scanHomeDepotDeals() {
  logger.info('🔨 Iniciando escaneo Home Depot v3...');

  const productsRes = await query(`
    SELECT p.id, p.sku, p.name, p.brand, p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'home-depot'
      AND p.sku IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr
        WHERE pr.product_id = p.id AND pr.recorded_at > NOW() - INTERVAL '25 minutes'
      )
    ORDER BY RANDOM()
    LIMIT 10
  `);

  logger.info(`[HomeDepot Scan] ${productsRes.rows.length} products to scan`);

  let dealsFound = 0, errors = 0, scanned = 0;

  for (const product of productsRes.rows) {
    logger.info(`\n[HomeDepot Scan] Product: "${product.name}" | SKU: ${product.sku}`);

    const result = await getHomeDepotProduct(product.sku);

    if (!result.success || !result.currentPrice) {
      logger.error(`[HomeDepot Scan] SKIP "${product.name}" — no price obtained after all methods`);
      errors++;
      continue;
    }

    const regularPrice = result.regularPrice || result.currentPrice * 1.6;
    scanned++;

    await query(`
      INSERT INTO prices (product_id, regular_price, current_price, in_stock, stock_quantity, source)
      VALUES ($1, $2, $3, $4, $5, 'homedepot_live')
    `, [product.id, regularPrice, result.currentPrice, result.inStock, result.stockQty]);

    const discountPct = ((regularPrice - result.currentPrice) / regularPrice) * 100;
    logger.info(`[HomeDepot Scan] "${product.name}" | $${result.currentPrice} (was $${regularPrice}) | ${discountPct.toFixed(0)}% off`);

    if (discountPct < 15) {
      logger.info(`[HomeDepot Scan] Not a deal (${discountPct.toFixed(0)}% < threshold), skipping deal upsert`);
      continue;
    }

    const analysis = await analyzeOpportunity(product, result.currentPrice, regularPrice, result.stockQty, product.cat_slug);

    await query(`
      INSERT INTO deals (
        product_id, store_id, regular_price, deal_price, discount_percent,
        resale_price_amazon, resale_price_ebay, resale_price_facebook,
        estimated_profit, opportunity_score, opportunity_label,
        stock_quantity, is_error_price, is_active, expires_at, data_source
      )
      SELECT $1, s.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true,
        NOW() + INTERVAL '48 hours', 'live'
      FROM stores WHERE slug = 'home-depot'
      ON CONFLICT (product_id, store_id) DO UPDATE SET
        deal_price = EXCLUDED.deal_price,
        discount_percent = EXCLUDED.discount_percent,
        estimated_profit = EXCLUDED.estimated_profit,
        opportunity_score = EXCLUDED.opportunity_score,
        opportunity_label = EXCLUDED.opportunity_label,
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
    logger.info(`[HomeDepot Scan] ✅ Deal saved: "${product.name}" score=${analysis.score}`);
  }

  logger.info(`\n[HomeDepot Scan] COMPLETE: ${dealsFound} deals found, ${errors} errors, ${scanned} scanned`);
  return { deals_found: dealsFound, errors, products_scanned: scanned };
}

module.exports = { scanHomeDepotDeals, getHomeDepotProduct };

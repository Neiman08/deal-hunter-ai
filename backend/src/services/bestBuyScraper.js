/**
 * Best Buy Scraper — Módulo independiente con 4 métodos y diagnóstico completo
 *
 * ══════════════════════════════════════════════════════════════════
 *  POR QUÉ BEST BUY ES DIFERENTE A WALMART
 * ══════════════════════════════════════════════════════════════════
 *
 * Best Buy tiene una API pública oficial y gratuita:
 *   https://developer.bestbuy.com
 *   - Registro instantáneo, key por email en segundos
 *   - 5 requests/seg, 50,000/día gratis
 *   - Devuelve: precio, salePrice, openBoxPrice, clearance, stock,
 *     disponibilidad por tienda, imagen, categoría
 *
 * Además, su endpoint de búsqueda JSON es público sin autenticación,
 * lo que hace posible el método de emergencia sin ninguna API key.
 *
 * ══════════════════════════════════════════════════════════════════
 *  CADENA DE MÉTODOS
 * ══════════════════════════════════════════════════════════════════
 *
 *  M1: Best Buy Products API (oficial, requiere BESTBUY_API_KEY)
 *      GET https://api.bestbuy.com/v1/products/{sku}.json?apiKey=...
 *      → Precio, salePrice, openBoxPrice, clearance, stock, imagen
 *
 *  M2: Best Buy Search API (oficial, requiere BESTBUY_API_KEY)
 *      GET https://api.bestbuy.com/v1/products(sku={sku})
 *      → Fallback si el endpoint por SKU directo falla
 *
 *  M3: Página del producto — extracción de JSON embebido (__NEXT_DATA__)
 *      GET https://www.bestbuy.com/site/{sku}.p
 *      → No requiere API key, funciona desde IPs de servidor
 *        porque Best Buy NO bloquea scrapers con la misma agresividad que Walmart
 *
 *  M4: Regex fallback sobre HTML crudo
 *      Patterns: window.__INITIAL_STATE__, data-price, priceBlock JSON
 *
 * ══════════════════════════════════════════════════════════════════
 *  SETUP (30 segundos)
 * ══════════════════════════════════════════════════════════════════
 *
 *  1. Ve a https://developer.bestbuy.com
 *  2. Click "Get API Key"
 *  3. Ingresa email → key llega en segundos
 *  4. Agrega en .env:
 *     BESTBUY_API_KEY=tu_key_aqui
 *
 * ══════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { analyzeOpportunity } = require('./opportunityEngine');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY_MS) || 1500;

// Best Buy acepta requests de servidor — no necesita rotación agresiva
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.bestbuy.com/',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
};

// ─── Helper: construye el objeto resultado estándar ────────────────────────────
function makeResult(success, data, method, diagnostics) {
  return { success, ...data, method_used: method, diagnostics };
}

// ─── Helper: normaliza el SKU (Best Buy usa números de 7 dígitos) ──────────────
function normalizeSku(sku) {
  // Acepta "6505727", "SKU6505727", "6505727.p", etc.
  return String(sku).replace(/[^0-9]/g, '');
}

// ══════════════════════════════════════════════════════════════════
//  M1: Best Buy Products API — endpoint directo por SKU
// ══════════════════════════════════════════════════════════════════
async function tryProductsAPI(sku) {
  const apiKey = process.env.BESTBUY_API_KEY;

  if (!apiKey) {
    return makeResult(false, {}, 'products_api', {
      skipped: true,
      reason: 'BESTBUY_API_KEY no configurada',
      solution: [
        'Best Buy tiene API gratuita — setup en 30 segundos:',
        '1. Ve a https://developer.bestbuy.com',
        '2. Click "Get API Key" → ingresa tu email',
        '3. Recibes la key en segundos (no requiere aprobación)',
        '4. Agrega en .env: BESTBUY_API_KEY=tu_key_aqui',
        '5. Límite gratuito: 50,000 requests/día',
      ].join('\n'),
    });
  }

  const url = `https://api.bestbuy.com/v1/products/${sku}.json`;
  logger.info(`[BB M1] Products API | SKU: ${sku} | URL: ${url}`);

  try {
    const res = await axios.get(url, {
      params: {
        apiKey,
        show: [
          'sku', 'name', 'manufacturer', 'modelNumber', 'upc',
          'regularPrice', 'salePrice', 'priceUpdateDate',
          'percentSavings', 'onSale',
          'openBoxPrice', 'openBox', 'clearance',
          'inStoreAvailability', 'onlineAvailability',
          'inStoreAvailabilityText', 'onlineAvailabilityText',
          'quantityLimit', 'availableOnline',
          'categoryPath', 'thumbnailImage', 'image',
          'url', 'mobileUrl', 'addToCartUrl',
          'shortDescription', 'longDescription',
          'condition', 'new',
          'dealEndDate', 'bestBuyItemId',
        ].join(','),
        format: 'json',
      },
      timeout: 10000,
    });

    logger.info(`[BB M1] HTTP ${res.status} | SKU en respuesta: ${res.data?.sku}`);

    if (!res.data || !res.data.sku) {
      return makeResult(false, {}, 'products_api', {
        http_status: res.status,
        reason: 'Respuesta vacía o sin campo sku — SKU posiblemente no existe en catálogo BB',
        response_keys: Object.keys(res.data || {}),
        sku_tried: sku,
      });
    }

    const p = res.data;
    const currentPrice = p.salePrice ?? p.regularPrice ?? null;

    if (!currentPrice) {
      return makeResult(false, {}, 'products_api', {
        http_status: res.status,
        reason: 'Producto encontrado pero salePrice y regularPrice son ambos null',
        price_fields: { salePrice: p.salePrice, regularPrice: p.regularPrice },
        sku: p.sku,
        name: p.name,
      });
    }

    const normalized = normalizeBestBuyProduct(p, 'products_api');
    logger.info(`[BB M1] ✅ ${normalized.name} | $${normalized.currentPrice} | clearance: ${normalized.clearance} | openBox: ${normalized.openBoxPrice}`);
    return makeResult(true, normalized, 'products_api', { http_status: res.status });

  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;

    if (status === 403) {
      logger.error(`[BB M1] 403 Forbidden — API key inválida o expirada`);
      return makeResult(false, {}, 'products_api', {
        http_status: 403,
        reason: 'API key inválida, expirada, o excediste el límite diario de requests',
        solution: 'Verifica la key en https://developer.bestbuy.com o solicita una nueva',
        response_body: body,
      });
    }

    if (status === 404) {
      logger.warn(`[BB M1] 404 — SKU ${sku} no encontrado en catálogo Best Buy`);
      return makeResult(false, {}, 'products_api', {
        http_status: 404,
        reason: `SKU ${sku} no existe en el catálogo de Best Buy`,
        hint: 'Verifica el SKU en bestbuy.com — el número aparece en la URL del producto',
      });
    }

    if (status === 429) {
      logger.error(`[BB M1] 429 Rate limit — demasiadas requests`);
      return makeResult(false, {}, 'products_api', {
        http_status: 429,
        reason: 'Rate limit excedido (5 req/seg o 50,000/día)',
        hint: 'Espera 1 segundo entre requests. El límite diario se resetea a medianoche.',
      });
    }

    logger.error(`[BB M1] Error | HTTP ${status ?? 'sin_respuesta'} | ${err.message}`);
    if (body) logger.error(`[BB M1] Body: ${JSON.stringify(body).slice(0, 300)}`);

    return makeResult(false, {}, 'products_api', {
      http_status: status,
      error_message: err.message,
      error_code: err.code,
      response_body: body,
    });
  }
}

// ══════════════════════════════════════════════════════════════════
//  M2: Best Buy Search API — query por SKU (fallback de M1)
// ══════════════════════════════════════════════════════════════════
async function trySearchAPI(sku) {
  const apiKey = process.env.BESTBUY_API_KEY;

  if (!apiKey) {
    return makeResult(false, {}, 'search_api', {
      skipped: true,
      reason: 'BESTBUY_API_KEY no configurada — mismo requisito que M1',
    });
  }

  const url = `https://api.bestbuy.com/v1/products(sku=${sku})`;
  logger.info(`[BB M2] Search API | SKU: ${sku} | URL: ${url}`);

  await sleep(300); // Respetar rate limit de 5 req/seg

  try {
    const res = await axios.get(url, {
      params: {
        apiKey,
        show: 'sku,name,manufacturer,regularPrice,salePrice,openBoxPrice,openBox,clearance,inStoreAvailability,onlineAvailability,thumbnailImage,url,condition,percentSavings',
        format: 'json',
        pageSize: 1,
      },
      timeout: 10000,
    });

    logger.info(`[BB M2] HTTP ${res.status} | total: ${res.data?.total} | products: ${res.data?.products?.length}`);

    const products = res.data?.products;
    if (!products?.length) {
      return makeResult(false, {}, 'search_api', {
        http_status: res.status,
        reason: `Search API devolvió 0 productos para sku=${sku}`,
        total_returned: res.data?.total,
      });
    }

    const p = products[0];
    const currentPrice = p.salePrice ?? p.regularPrice ?? null;

    if (!currentPrice) {
      return makeResult(false, {}, 'search_api', {
        http_status: res.status,
        reason: 'Producto en Search API pero sin precio',
        product_sku: p.sku,
        price_fields: { salePrice: p.salePrice, regularPrice: p.regularPrice },
      });
    }

    const normalized = normalizeBestBuyProduct(p, 'search_api');
    logger.info(`[BB M2] ✅ ${normalized.name} | $${normalized.currentPrice}`);
    return makeResult(true, normalized, 'search_api', { http_status: res.status });

  } catch (err) {
    const status = err.response?.status;
    logger.error(`[BB M2] Error | HTTP ${status ?? 'sin_respuesta'} | ${err.message}`);
    return makeResult(false, {}, 'search_api', {
      http_status: status,
      error_message: err.message,
      error_code: err.code,
    });
  }
}

// ══════════════════════════════════════════════════════════════════
//  M3: Página del producto — extracción de __NEXT_DATA__ / window.__INITIAL_STATE__
//  Best Buy NO bloquea IPs de servidor como Walmart, solo rate-limita
// ══════════════════════════════════════════════════════════════════
async function tryProductPage(sku) {
  // Best Buy usa dos formatos de URL según el producto
  const urls = [
    `https://www.bestbuy.com/site/searchpage.jsp?st=${sku}`,
    `https://www.bestbuy.com/site/${sku}.p`,
  ];

  for (const url of urls) {
    logger.info(`[BB M3] Página producto | SKU: ${sku} | URL: ${url}`);
    await sleep(REQUEST_DELAY);

    let res;
    try {
      res = await axios.get(url, {
        headers: HEADERS,
        timeout: 15000,
        maxRedirects: 5,
      });
    } catch (err) {
      const status = err.response?.status;
      logger.warn(`[BB M3] ${url} → HTTP ${status ?? 'sin_respuesta'} | ${err.message}`);
      continue; // Prueba la siguiente URL
    }

    logger.info(`[BB M3] HTTP ${res.status} | Content-Length: ${res.data?.length ?? 0} | URL final: ${res.request?.res?.responseUrl ?? url}`);

    if (res.status !== 200) {
      logger.warn(`[BB M3] Status no-200: ${res.status}`);
      continue;
    }

    const html = res.data;

    // Verificar bot detection
    if (html.includes('Are you a robot') || html.includes('captcha') || html.length < 5000) {
      logger.warn(`[BB M3] Posible bot detection — HTML muy corto (${html.length} chars) o contiene 'robot'/'captcha'`);
      return makeResult(false, {}, 'product_page', {
        http_status: res.status,
        reason: `Bot detection probable — respuesta de ${html.length} chars`,
        url_tried: url,
        html_snippet: html.slice(0, 300).replace(/\n/g, ' '),
      });
    }

    // ── Intento A: window.__INITIAL_STATE__ (más común en BB) ──────────────
    const initStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});\s*(?:window|<\/script>)/s);
    if (initStateMatch) {
      logger.info(`[BB M3] window.__INITIAL_STATE__ encontrado (${initStateMatch[1].length} chars)`);
      try {
        const state = JSON.parse(initStateMatch[1]);

        // Navegar la estructura del estado de BB
        const pdpData = state?.pdp?.listings?.primary
          || state?.productDetail?.pdpData
          || state?.page?.data?.pageData?.product
          || state?.app?.page?.api?.pageData?.product
          || null;

        logger.info(`[BB M3] pdpData encontrado: ${!!pdpData}`);

        if (pdpData) {
          const price = pdpData.priceInfo?.currentPrice
            || pdpData.pricing?.currentPrice
            || pdpData.price
            || null;

          logger.info(`[BB M3] price en pdpData: ${price}`);

          if (price) {
            const normalized = normalizeFromPageData(pdpData, sku, 'product_page_initial_state');
            logger.info(`[BB M3] ✅ via __INITIAL_STATE__ | ${normalized.name} | $${normalized.currentPrice}`);
            return makeResult(true, normalized, 'product_page', {
              http_status: res.status,
              extraction_method: '__INITIAL_STATE__',
              url_used: url,
            });
          }
        }
      } catch (parseErr) {
        logger.warn(`[BB M3] JSON.parse de __INITIAL_STATE__ falló: ${parseErr.message}`);
      }
    }

    // ── Intento B: __NEXT_DATA__ ──────────────────────────────────────────
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/s)
      || html.match(/__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/s);

    if (nextDataMatch) {
      logger.info(`[BB M3] __NEXT_DATA__ encontrado (${nextDataMatch[1].length} chars)`);
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const product = nextData?.props?.pageProps?.productDetails
          || nextData?.props?.pageProps?.initialData?.product
          || nextData?.props?.initialProps?.product
          || null;

        logger.info(`[BB M3] product en __NEXT_DATA__: ${!!product}`);

        if (product) {
          const currentPrice = product.currentPrice || product.salePrice || product.price || null;
          if (currentPrice) {
            const normalized = normalizeFromPageData(product, sku, 'product_page_next_data');
            logger.info(`[BB M3] ✅ via __NEXT_DATA__ | ${normalized.name} | $${normalized.currentPrice}`);
            return makeResult(true, normalized, 'product_page', {
              http_status: res.status,
              extraction_method: '__NEXT_DATA__',
              url_used: url,
            });
          }
        }
      } catch (parseErr) {
        logger.warn(`[BB M3] JSON.parse de __NEXT_DATA__ falló: ${parseErr.message}`);
      }
    }

    logger.warn(`[BB M3] ${url}: HTML recibido pero sin estructura JSON reconocida`);
    logger.warn(`[BB M3] Tiene __INITIAL_STATE__: ${html.includes('__INITIAL_STATE__')} | Tiene __NEXT_DATA__: ${html.includes('__NEXT_DATA__')}`);
  }

  return makeResult(false, {}, 'product_page', {
    reason: 'Ninguna de las 2 URLs devolvió estructura JSON reconocida (__INITIAL_STATE__ o __NEXT_DATA__)',
    urls_tried: urls,
    hint: 'Best Buy puede haber cambiado la estructura del estado. Activa BESTBUY_API_KEY para datos confiables.',
  });
}

// ══════════════════════════════════════════════════════════════════
//  M4: Regex sobre HTML crudo — último recurso
// ══════════════════════════════════════════════════════════════════
async function tryRegexFallback(sku) {
  const url = `https://www.bestbuy.com/site/${sku}.p`;
  logger.info(`[BB M4] Regex fallback | SKU: ${sku} | URL: ${url}`);

  await sleep(REQUEST_DELAY + 1000);

  let html;
  let httpStatus;
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });
    html = res.data;
    httpStatus = res.status;
    logger.info(`[BB M4] HTTP ${httpStatus} | ${html.length} chars`);
  } catch (err) {
    const status = err.response?.status;
    logger.error(`[BB M4] HTTP ${status ?? 'sin_respuesta'} | ${err.message}`);
    return makeResult(false, {}, 'regex_fallback', {
      http_status: status,
      error_message: err.message,
      error_code: err.code,
    });
  }

  if (httpStatus !== 200) {
    return makeResult(false, {}, 'regex_fallback', {
      http_status: httpStatus,
      reason: `Status HTTP ${httpStatus} — producto no disponible o URL incorrecta`,
    });
  }

  // Patrones de precio específicos de Best Buy
  const pricePatterns = [
    { regex: /"currentPrice"\s*:\s*([\d.]+)/,            label: 'currentPrice JSON' },
    { regex: /"salePrice"\s*:\s*([\d.]+)/,               label: 'salePrice JSON' },
    { regex: /"priceBlockAria"[^"]*"\$\s*([\d,]+\.\d{2})/, label: 'priceBlockAria' },
    { regex: /data-automation-id="product-price"[^>]*>\s*\$\s*([\d,]+\.\d{2})/, label: 'data-automation-id' },
    { regex: /"regularPrice"\s*:\s*([\d.]+)/,            label: 'regularPrice JSON' },
    { regex: /class="[^"]*priceView-customer-price[^"]*"[^>]*>\s*<span[^>]*>\$([\d,]+\.\d{2})/, label: 'priceView CSS' },
    { regex: /"price"\s*:\s*\{\s*"currentPrice"\s*:\s*([\d.]+)/, label: 'price.currentPrice nested' },
  ];

  let currentPrice = null;
  let matchedPattern = null;
  for (const { regex, label } of pricePatterns) {
    const m = html.match(regex);
    if (m) {
      const parsed = parseFloat(m[1].replace(/,/g, ''));
      if (parsed > 0) {
        currentPrice = parsed;
        matchedPattern = label;
        break;
      }
    }
  }

  logger.info(`[BB M4] Precio encontrado: ${currentPrice} via patrón: ${matchedPattern ?? 'ninguno'}`);

  if (!currentPrice) {
    // Reportar qué patrones sí estaban presentes en el HTML para diagnóstico
    const presentes = pricePatterns
      .filter(({ regex }) => html.match(regex))
      .map(({ label }) => label);

    return makeResult(false, {}, 'regex_fallback', {
      http_status: httpStatus,
      reason: 'Ninguno de los 7 patrones regex de precio coincidió con el HTML de Best Buy',
      patterns_tried: pricePatterns.map(p => p.label),
      patterns_partially_present: presentes,
      html_length: html.length,
      hint: 'Best Buy actualizó su HTML. Activa BESTBUY_API_KEY para datos confiables.',
    });
  }

  // Extraer nombre del producto
  const namePatterns = [
    /"productTitle"\s*:\s*"([^"]{10,200})"/,
    /<h1[^>]*class="[^"]*heading-5[^"]*"[^>]*>([^<]{10,200})<\/h1>/,
    /"name"\s*:\s*"([^"]{10,200})"/,
    /<title>([^|<]{10,200})\s*[\|<]/,
  ];

  let name = `Best Buy SKU ${sku}`;
  for (const regex of namePatterns) {
    const m = html.match(regex);
    if (m?.[1]?.trim()) {
      name = m[1].trim()
        .replace(/\\u[\dA-Fa-f]{4}/g, c => String.fromCharCode(parseInt(c.slice(2), 16)))
        .replace(/\\"/g, '"');
      break;
    }
  }

  // Precio regular (puede no estar en todos los casos)
  const regularPriceMatch = html.match(/"regularPrice"\s*:\s*([\d.]+)/);
  const regularPrice = regularPriceMatch ? parseFloat(regularPriceMatch[1]) : currentPrice * 1.3;

  // Clearance flag
  const clearance = html.includes('"clearance":true') || html.includes('clearancePrice');

  // Open box
  const openBoxMatch = html.match(/"openBoxPrice"\s*:\s*([\d.]+)/);
  const openBoxPrice = openBoxMatch ? parseFloat(openBoxMatch[1]) : null;

  // Imagen
  const imgMatch = html.match(/"image"\s*:\s*"([^"]+\.jpg[^"]*)"/);
  const imageUrl = imgMatch?.[1]?.replace(/\\u002F/g, '/') || null;

  const normalized = {
    name,
    brand: null,
    sku,
    currentPrice,
    regularPrice,
    discountPercent: regularPrice > currentPrice
      ? Math.round(((regularPrice - currentPrice) / regularPrice) * 100)
      : 0,
    openBoxPrice,
    clearance,
    dealOfTheDay: html.includes('"dealOfTheDay":true'),
    onlineAvailable: !html.includes('"onlineAvailability":false'),
    inStoreAvailable: html.includes('"inStoreAvailability":true'),
    imageUrl,
    productUrl: `https://www.bestbuy.com/site/${sku}.p`,
    condition: 'New',
    data_source: 'live',
  };

  logger.info(`[BB M4] ✅ ${name} | $${currentPrice} | patrón: ${matchedPattern}`);
  return makeResult(true, normalized, 'regex_fallback', {
    http_status: httpStatus,
    pattern_used: matchedPattern,
  });
}

// ══════════════════════════════════════════════════════════════════
//  Normalización desde Best Buy Products API
// ══════════════════════════════════════════════════════════════════
function normalizeBestBuyProduct(p, source) {
  const currentPrice = parseFloat(p.salePrice ?? p.regularPrice ?? 0);
  const regularPrice = parseFloat(p.regularPrice ?? p.salePrice ?? 0);
  const discountPercent = regularPrice > currentPrice && regularPrice > 0
    ? Math.round(((regularPrice - currentPrice) / regularPrice) * 100)
    : (p.percentSavings ? Math.round(parseFloat(p.percentSavings)) : 0);

  // categoryPath puede ser array de objetos o string
  let categoryName = null;
  if (Array.isArray(p.categoryPath)) {
    categoryName = p.categoryPath[p.categoryPath.length - 1]?.name || null;
  } else if (typeof p.categoryPath === 'string') {
    categoryName = p.categoryPath.split('>').pop()?.trim() || null;
  }

  return {
    name: p.name || null,
    brand: p.manufacturer || p.brand || null,
    sku: String(p.sku),
    upc: p.upc || null,
    model: p.modelNumber || null,
    currentPrice,
    regularPrice,
    discountPercent,
    onSale: p.onSale || discountPercent > 0,
    openBoxPrice: p.openBoxPrice ? parseFloat(p.openBoxPrice) : null,
    openBox: p.openBox || false,
    clearance: p.clearance || false,
    dealOfTheDay: p.dealEndDate ? true : false,
    dealEndDate: p.dealEndDate || null,
    onlineAvailable: p.onlineAvailability !== false,
    onlineAvailabilityText: p.onlineAvailabilityText || null,
    inStoreAvailable: p.inStoreAvailability || false,
    inStoreAvailabilityText: p.inStoreAvailabilityText || null,
    quantityLimit: p.quantityLimit || null,
    imageUrl: p.image || p.thumbnailImage || null,
    productUrl: p.url || p.mobileUrl || `https://www.bestbuy.com/site/${p.sku}.p`,
    condition: p.condition || (p.new ? 'New' : 'Unknown'),
    categoryName,
    shortDescription: p.shortDescription || null,
    data_source: 'live',
    source,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Normalización desde datos de página (M3)
// ══════════════════════════════════════════════════════════════════
function normalizeFromPageData(p, sku, source) {
  const currentPrice = parseFloat(
    p.currentPrice ?? p.salePrice ?? p.priceInfo?.currentPrice ?? p.price ?? 0
  );
  const regularPrice = parseFloat(
    p.regularPrice ?? p.priceInfo?.regularPrice ?? currentPrice * 1.3
  );

  return {
    name: p.name || p.title || p.productTitle || null,
    brand: p.manufacturer || p.brand || null,
    sku: String(p.sku || sku),
    currentPrice,
    regularPrice,
    discountPercent: regularPrice > currentPrice && regularPrice > 0
      ? Math.round(((regularPrice - currentPrice) / regularPrice) * 100)
      : 0,
    openBoxPrice: p.openBoxPrice ? parseFloat(p.openBoxPrice) : null,
    clearance: p.clearance || false,
    dealOfTheDay: p.dealOfTheDay || false,
    onlineAvailable: p.onlineAvailability !== false,
    inStoreAvailable: p.inStoreAvailability || false,
    imageUrl: p.image || p.thumbnailImage || p.imageUrl || null,
    productUrl: p.url || `https://www.bestbuy.com/site/${sku}.p`,
    condition: 'New',
    data_source: 'live',
    source,
  };
}

// ══════════════════════════════════════════════════════════════════
//  ENTRADA PRINCIPAL: prueba todos los métodos en orden
// ══════════════════════════════════════════════════════════════════
async function getBestBuyProduct(sku) {
  const cleanSku = normalizeSku(sku);

  if (!cleanSku || cleanSku.length < 4) {
    return {
      success: false,
      method_used: 'none',
      attempts: [],
      diagnostics: {
        reason: `SKU inválido: "${sku}" — debe ser un número de Best Buy (ej: 6505727)`,
        hint: 'El SKU de Best Buy aparece en la URL: bestbuy.com/site/nombre-producto/6505727.p',
      },
    };
  }

  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`[BestBuy] Lookup SKU: ${cleanSku} (original: ${sku})`);
  logger.info(`  BESTBUY_API_KEY configurada: ${!!process.env.BESTBUY_API_KEY}`);
  logger.info(`${'═'.repeat(60)}`);

  const attempts = [];

  // M1: Products API directa
  const m1 = await tryProductsAPI(cleanSku);
  attempts.push(m1);
  if (m1.success) {
    logger.info(`[BestBuy] ✅ Éxito via ${m1.method_used}`);
    return { ...m1, attempts };
  }

  // M2: Search API (solo si hay key y M1 no fue un 404)
  const m1Status = m1.diagnostics?.http_status;
  if (m1Status !== 404) { // Si fue 404, el producto no existe — no tiene sentido buscar más
    const m2 = await trySearchAPI(cleanSku);
    attempts.push(m2);
    if (m2.success) {
      logger.info(`[BestBuy] ✅ Éxito via ${m2.method_used}`);
      return { ...m2, attempts };
    }
  } else {
    logger.info(`[BestBuy] SKU 404 en API oficial — saltando M2/M3/M4`);
    attempts.push(makeResult(false, {}, 'search_api', {
      skipped: true,
      reason: 'Saltado porque M1 devolvió 404 — el SKU no existe en Best Buy',
    }));
    attempts.push(makeResult(false, {}, 'product_page', {
      skipped: true,
      reason: 'Saltado porque M1 devolvió 404 — el SKU no existe en Best Buy',
    }));
    attempts.push(makeResult(false, {}, 'regex_fallback', {
      skipped: true,
      reason: 'Saltado porque M1 devolvió 404 — el SKU no existe en Best Buy',
    }));
    return {
      success: false,
      method_used: 'none',
      attempts,
      diagnostics: {
        reason: `SKU ${cleanSku} no existe en el catálogo de Best Buy (HTTP 404)`,
        hint: 'Verifica el número en bestbuy.com. Ejemplo válido: 6505727 (LG TV)',
      },
    };
  }

  // M3: Página del producto — funciona sin API key
  const m3 = await tryProductPage(cleanSku);
  attempts.push(m3);
  if (m3.success) {
    logger.info(`[BestBuy] ✅ Éxito via ${m3.method_used}`);
    return { ...m3, attempts };
  }

  // M4: Regex como último recurso
  const m4 = await tryRegexFallback(cleanSku);
  attempts.push(m4);
  if (m4.success) {
    logger.info(`[BestBuy] ✅ Éxito via ${m4.method_used} (regex)`);
    return { ...m4, attempts };
  }

  logger.error(`[BestBuy] TODOS LOS MÉTODOS FALLARON para SKU: ${cleanSku}`);
  logger.error(`[BestBuy] Resumen:`);
  attempts.forEach((a, i) => {
    const d = a.diagnostics;
    const msg = d?.reason || d?.error_message || (d?.skipped ? 'skipped' : 'unknown');
    logger.error(`  M${i + 1} (${a.method_used}): ${msg}`);
  });

  return { success: false, method_used: 'none', attempts };
}

// ══════════════════════════════════════════════════════════════════
//  Obtener disponibilidad por tiendas (requiere API key)
// ══════════════════════════════════════════════════════════════════
async function getBestBuyStoreAvailability(sku, postalCode = '77001') {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) return { available: false, stores: [], reason: 'BESTBUY_API_KEY no configurada' };

  const cleanSku = normalizeSku(sku);
  const url = `https://api.bestbuy.com/v1/stores(area(${postalCode},25))+products(sku=${cleanSku})`;

  logger.info(`[BB Stores] SKU: ${cleanSku} | ZIP: ${postalCode}`);

  try {
    const res = await axios.get(url, {
      params: {
        apiKey,
        show: 'stores.storeId,stores.name,stores.address,stores.city,stores.state,stores.postalCode,stores.distance,stores.storeHours,stores.products.sku,stores.products.name,stores.products.inStoreAvailability,stores.products.onlineAvailability,stores.products.quantityOnHand',
        format: 'json',
      },
      timeout: 10000,
    });

    const stores = res.data?.stores || [];
    logger.info(`[BB Stores] ${stores.length} tiendas en radio de 25mi`);

    return {
      available: stores.some(s => s.products?.[0]?.inStoreAvailability),
      stores: stores.slice(0, 8).map(s => ({
        storeId: s.storeId,
        name: s.name,
        address: s.address,
        city: s.city,
        state: s.state,
        distance: s.distance,
        inStock: s.products?.[0]?.inStoreAvailability || false,
        quantityOnHand: s.products?.[0]?.quantityOnHand || 0,
      })),
    };
  } catch (err) {
    logger.error(`[BB Stores] Error: ${err.message}`);
    return { available: false, stores: [], reason: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
//  SCAN JOB — escanea todos los productos Best Buy en DB
// ══════════════════════════════════════════════════════════════════
async function scanBestBuyDeals() {
  logger.info('🟦 Iniciando escaneo Best Buy...');

  const productsRes = await query(`
    SELECT p.id, p.sku, p.upc, p.name, p.brand, p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'best-buy'
      AND p.sku IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr
        WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT 15
  `);

  logger.info(`[BB Scan] ${productsRes.rows.length} productos a escanear`);

  let dealsFound = 0, errors = 0, scanned = 0;

  for (const product of productsRes.rows) {
    logger.info(`\n[BB Scan] "${product.name}" | SKU: ${product.sku}`);

    const result = await getBestBuyProduct(product.sku);

    if (!result.success || !result.currentPrice) {
      logger.error(`[BB Scan] SKIP "${product.name}" — sin precio`);
      errors++;
      continue;
    }

    const regularPrice = result.regularPrice || result.currentPrice * 1.3;
    scanned++;

    // Guardar en historial de precios
    await query(`
      INSERT INTO prices (product_id, regular_price, current_price, in_stock, source)
      VALUES ($1, $2, $3, $4, 'bestbuy_live')
    `, [product.id, regularPrice, result.currentPrice, result.onlineAvailable ?? true]);

    // Actualizar metadata del producto
    if (result.imageUrl || result.productUrl) {
      await query(`
        UPDATE products SET
          image_url  = COALESCE($1, image_url),
          product_url = COALESCE($2, product_url),
          updated_at = NOW()
        WHERE id = $3
      `, [result.imageUrl, result.productUrl, product.id]);
    }

    const discountPct = ((regularPrice - result.currentPrice) / regularPrice) * 100;
    logger.info(`[BB Scan] $${result.currentPrice} (era $${regularPrice}) | ${discountPct.toFixed(0)}% off | clearance: ${result.clearance} | openBox: ${result.openBoxPrice}`);

    // Umbral: 10% para Best Buy (tienen más promos que Walmart/HD)
    if (discountPct < 10 && !result.clearance && !result.openBoxPrice) {
      logger.info(`[BB Scan] Sin deal significativo — skip`);
      continue;
    }

    const analysis = await analyzeOpportunity(
      product, result.currentPrice, regularPrice, null, product.cat_slug
    );

    // Upsert deal marcado como 'live'
    await query(`
      INSERT INTO deals (
        product_id, store_id, regular_price, deal_price, discount_percent,
        resale_price_amazon, resale_price_ebay, resale_price_facebook,
        estimated_profit, opportunity_score, opportunity_label,
        stock_quantity, is_error_price, liquidation_type, liquidation_badge,
        is_active, expires_at, data_source
      )
      SELECT $1, s.id, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             NULL, $11, $12, $13, true, NOW() + INTERVAL '24 hours', 'live'
      FROM stores WHERE slug = 'best-buy'
      ON CONFLICT (product_id, store_id) DO UPDATE SET
        deal_price        = EXCLUDED.deal_price,
        discount_percent  = EXCLUDED.discount_percent,
        estimated_profit  = EXCLUDED.estimated_profit,
        opportunity_score = EXCLUDED.opportunity_score,
        opportunity_label = EXCLUDED.opportunity_label,
        liquidation_type  = EXCLUDED.liquidation_type,
        liquidation_badge = EXCLUDED.liquidation_badge,
        data_source       = 'live',
        last_seen_at      = NOW(),
        is_active         = true
    `, [
      product.id, regularPrice, result.currentPrice, discountPct,
      analysis.resale?.amazonPrice, analysis.resale?.ebayPrice, analysis.resale?.fbPrice,
      analysis.resale?.netProfit, analysis.score, analysis.label,
      result.clearance || analysis.isErrorPrice,
      result.clearance ? 'CLEARANCE' : (result.openBoxPrice ? 'OPEN_BOX' : null),
      result.clearance ? '🔴 CLEARANCE' : (result.openBoxPrice ? '📦 OPEN BOX' : null),
    ]);

    dealsFound++;
    logger.info(`[BB Scan] ✅ Deal guardado: "${product.name}" score=${analysis.score}`);
  }

  logger.info(`\n[BB Scan] COMPLETO: ${dealsFound} deals, ${errors} errores, ${scanned} escaneados`);
  return { deals_found: dealsFound, errors, products_scanned: scanned };
}

module.exports = {
  getBestBuyProduct,
  getBestBuyStoreAvailability,
  scanBestBuyDeals,
  normalizeSku,
};

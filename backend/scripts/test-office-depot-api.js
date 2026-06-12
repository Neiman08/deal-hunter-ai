/**
 * Validación aislada: API GraphQL de Office Depot con JWT dinámico
 *
 * Flujo:
 *  1. GET página del producto → extrae JWT (HS512) del HTML + retailer-visitor-id de cookies
 *  2. POST /sku-details-service/skuinfo con ese JWT
 *  3. Parsea title, sku, currentPrice, regularPrice, availability
 *
 * Sin Playwright, sin DB, sin queue.
 *
 * Uso:
 *   node backend/scripts/test-office-depot-api.js
 *   node backend/scripts/test-office-depot-api.js 123456
 */

const https  = require('https');
const zlib   = require('zlib');
const crypto = require('crypto');

const SKU = process.argv[2] || '100512';

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function request({ method = 'GET', hostname, path, headers = {}, body = null }, hops = 0) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers, rejectUnauthorized: false };
    const req = https.request(opts, res => {
      // Follow redirects, accumulating Set-Cookie headers
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc  = res.headers.location;
        const next = loc.startsWith('http') ? new URL(loc) : new URL(loc, `https://${hostname}`);
        const newCookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        const prevCookie = headers['cookie'] || '';
        const merged     = [...(prevCookie ? [prevCookie] : []), ...newCookies].join('; ');
        return request({
          method: method === 'POST' && res.statusCode === 303 ? 'GET' : method,
          hostname: next.hostname,
          path:     next.pathname + next.search,
          headers:  { ...headers, cookie: merged, host: next.hostname },
          body:     method === 'POST' && res.statusCode !== 303 ? body : null,
        }, hops + 1).then(r => {
          // Merge parent cookies into child response
          r.headers['set-cookie'] = [
            ...(res.headers['set-cookie'] || []),
            ...(r.headers['set-cookie']   || []),
          ];
          resolve(r);
        }).catch(reject);
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        const dec = enc.includes('gzip') || enc.includes('deflate')
          ? cb => zlib.unzip(raw, cb)
          : cb => cb(null, raw);
        dec((err, buf) => err
          ? reject(err)
          : resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8') }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.setTimeout(20000);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Step 1: obtener JWT dinámico de la página del producto ──────────────────

async function fetchOdSession(sku) {
  const res = await request({
    hostname: 'www.officedepot.com',
    path:     `/a/products/${sku}/`,
    headers: {
      'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      'Accept':          'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  // Extraer JWT HS512 embebido en el HTML
  const jwtMatch = res.body.match(/eyJhbGciOiJIUzUxMiI[A-Za-z0-9_.-]{50,}/);
  const jwt = jwtMatch ? jwtMatch[0] : null;

  // Extraer retailer-visitor-id de cookies
  const rawCookies = res.headers['set-cookie'] || [];
  const cookieMap  = {};
  rawCookies.forEach(c => {
    const [kv] = c.split(';');
    const eq   = kv.indexOf('=');
    if (eq > 0) cookieMap[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  });

  const visitorId = cookieMap['retailer-visitor-id'] || crypto.randomUUID();
  const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

  return { jwt, visitorId, cookieStr, pageStatus: res.status };
}

// ─── Step 2: llamar a la API GraphQL ─────────────────────────────────────────

const GQL_QUERY = (sku, visitorId) => `{
  getData(
    sku: "${sku}",
    site: "OD",
    store: "3379",
    src: "sku-page-1727909732053",
    couponCode: "",
    hidePrice: false,
    regionId: "",
    customerEnteredSku: "${sku}",
    isMarketplaceSku: false,
    slotIds: [10230],
    retailerVisitorId: "${visitorId}",
    fwdFor: "99.89.80.196"
  ) {
    catalog {
      title sku upc brand images scene7ImageUrl
      breadcrumbs { description }
    }
    skuDetails {
      skuId: sku
      quantity
      skuDisplayAllowedFlag
      price {
        sellPrice    { price formattedPrice }
        regularPrice { price formattedPrice }
      }
    }
  }
}`;

async function fetchSkuData(sku, jwt, visitorId, cookieStr) {
  const payload = JSON.stringify({ query: GQL_QUERY(sku, visitorId), variables: null });

  const res = await request({
    method:   'POST',
    hostname: 'www.officedepot.com',
    path:     '/sku-details-service/skuinfo',
    headers: {
      'accept':              'application/json',
      'content-type':        'application/json',
      'content-length':      Buffer.byteLength(payload),
      'origin':              'https://www.officedepot.com',
      'referer':             `https://www.officedepot.com/a/products/${sku}/`,
      'user-agent':          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      'accept-encoding':     'gzip, deflate',
      'accept-language':     'en-US,en;q=0.9',
      'isaccesstoken':       'false',
      'isbloomreachenabled': 'false',
      'trxid':               `${sku}-${crypto.randomUUID()}`,
      'sec-fetch-dest':      'empty',
      'sec-fetch-mode':      'cors',
      'sec-fetch-site':      'same-origin',
      ...(jwt       ? { 'jwt':    jwt       } : {}),
      ...(cookieStr ? { 'cookie': cookieStr } : {}),
    },
    body: payload,
  });

  return { status: res.status, data: JSON.parse(res.body) };
}

// ─── Parse response ───────────────────────────────────────────────────────────

function parseResult(data) {
  const catalog    = data?.data?.getData?.catalog    || {};
  const skuDetails = data?.data?.getData?.skuDetails || {};
  const price      = skuDetails?.price               || {};

  const scene7  = (catalog.scene7ImageUrl || '').replace(/\/$/, '');
  const imgKey  = Array.isArray(catalog.images) ? catalog.images[0] : null;

  return {
    sku:          catalog.sku || skuDetails.skuId || null,
    title:        catalog.title                   || null,
    upc:          catalog.upc                     || null,
    brand:        catalog.brand                   || null,
    currentPrice: price?.sellPrice?.price         ?? null,
    regularPrice: price?.regularPrice?.price      ?? null,
    quantity:     skuDetails?.quantity            ?? null,
    available:    (skuDetails?.quantity > 0) && (skuDetails?.skuDisplayAllowedFlag === true),
    imageUrl:     imgKey ? (scene7 ? `${scene7}/${imgKey}` : imgKey) : null,
    category:     Array.isArray(catalog.breadcrumbs)
      ? catalog.breadcrumbs.map(b => b.description || '').filter(Boolean).join(' > ')
      : null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('═'.repeat(60));
  console.log('  Office Depot API — JWT dinámico');
  console.log(`  SKU: ${SKU}`);
  console.log('═'.repeat(60));

  // Step 1: sesión
  console.log('\n[1] Obteniendo JWT de página del producto...');
  const { jwt, visitorId, cookieStr, pageStatus } = await fetchOdSession(SKU);
  console.log(`    page status : ${pageStatus}`);
  console.log(`    jwt found   : ${jwt ? '✅ sí (' + jwt.slice(0, 40) + '...)' : '❌ no'}`);
  console.log(`    visitorId   : ${visitorId}`);

  if (!jwt) {
    console.log('\n  ❌ No se encontró JWT en la página. No se puede continuar.');
    process.exit(1);
  }

  // Step 2: API
  console.log('\n[2] Llamando a /sku-details-service/skuinfo...');
  const { status, data } = await fetchSkuData(SKU, jwt, visitorId, cookieStr);
  console.log(`    HTTP status : ${status}`);

  const errors = data?.errors || (data?.hasErrorResponse === 'true' ? [data.errorResponse] : []);
  if (errors.length) {
    console.log('    ❌ Errores:', JSON.stringify(errors).slice(0, 300));
    process.exit(1);
  }

  // Step 3: parse
  const result = parseResult(data);

  console.log('\n' + '═'.repeat(60));
  if (result.currentPrice) {
    console.log('  ✅ ÉXITO — precio obtenido');
  } else {
    console.log('  ⚠️  Sin precio. Estructura inesperada:');
    console.log(JSON.stringify(data?.data?.getData, null, 2).slice(0, 1000));
  }
  console.log('═'.repeat(60));
  console.log('\n  Resultado:');
  for (const [k, v] of Object.entries(result)) {
    console.log(`    ${k.padEnd(14)}: ${JSON.stringify(v)}`);
  }
  console.log('');
})();

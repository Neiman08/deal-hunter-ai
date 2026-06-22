/**
 * test-od-no-proxy.js
 *
 * Tests Office Depot discovery WITHOUT any proxy agent.
 * OD uses a GraphQL API (not Playwright) — pages and API are reachable
 * directly from our server IP.
 *
 * --dry-run  (default) : fetch + parse, no DB writes
 * --save               : write products/deals to DB
 * --max N              : max products to test (default 10)
 *
 * Usage:
 *   node scripts/test-od-no-proxy.js
 *   node scripts/test-od-no-proxy.js --max 20 --save
 */

require('dotenv').config();
const https  = require('https');
const zlib   = require('zlib');
const crypto = require('crypto');

// ─── CLI flags ────────────────────────────────────────────────────────────────
const argv   = process.argv.slice(2);
const DRY    = !argv.includes('--save');
const MAX    = parseInt((argv[argv.indexOf('--max') + 1]) || '10', 10) || 10;

console.log(`\n${'═'.repeat(60)}`);
console.log(`OD NO-PROXY TEST  |  max=${MAX}  |  ${DRY ? 'DRY RUN (no DB writes)' : '✅ SAVE MODE'}`);
console.log(`${'═'.repeat(60)}\n`);

// ─── HTTPS helper (no proxy agent) ───────────────────────────────────────────
function httpReq({ method = 'GET', hostname, path, headers = {}, body = null }, hops = 0) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers, rejectUnauthorized: false };
    const req  = https.request(opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc  = res.headers.location;
        const next = loc.startsWith('http') ? new URL(loc) : new URL(loc, `https://${hostname}`);
        const newCookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        const prevCookie = headers['cookie'] || '';
        const merged     = [...(prevCookie ? [prevCookie] : []), ...newCookies].join('; ');
        return httpReq({
          method: method === 'POST' && res.statusCode === 303 ? 'GET' : method,
          hostname: next.hostname, path: next.pathname + next.search,
          headers: { ...headers, cookie: merged, host: next.hostname },
          body: method === 'POST' && res.statusCode !== 303 ? body : null,
        }, hops + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        const decode = enc.includes('br')
          ? () => new Promise((r, j) => zlib.brotliDecompress(raw, (e, b) => e ? j(e) : r(b.toString('utf8'))))
          : enc.includes('gzip') || enc.includes('deflate')
          ? () => new Promise((r, j) => zlib.unzip(raw, (e, b) => e ? j(e) : r(b.toString('utf8'))))
          : () => Promise.resolve(raw.toString('utf8'));
        decode().then(body => resolve({ status: res.statusCode, headers: res.headers, body })).catch(reject);
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

// ─── OD session (JWT) — no proxy ─────────────────────────────────────────────
async function getOdSession() {
  console.log('[1] Fetching OD session (JWT) from product page...');
  const res = await httpReq({
    hostname: 'www.officedepot.com',
    path: '/a/products/100512/',
    headers: {
      'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      'Accept':          'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  console.log(`    → HTTP ${res.status}, body length: ${res.body.length}`);

  const jwtMatch = res.body.match(/eyJhbGciOiJIUzUxMiI[A-Za-z0-9_.-]{50,}/);
  if (!jwtMatch) throw new Error('OD JWT not found in page HTML');

  const rawCookies = res.headers['set-cookie'] || [];
  const cookieMap  = {};
  rawCookies.forEach(c => {
    const [kv] = c.split(';');
    const eq   = kv.indexOf('=');
    if (eq > 0) cookieMap[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  });
  const visitorId = cookieMap['retailer-visitor-id'] || crypto.randomUUID();
  const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

  console.log(`    → JWT found (${jwtMatch[0].length} chars), visitorId=${visitorId.slice(0, 12)}...`);
  return { jwt: jwtMatch[0], visitorId, cookieStr };
}

// ─── OD sitemap fetch (no proxy) ─────────────────────────────────────────────
async function fetchSitemap(index = 0) {
  console.log(`[2] Fetching OD sitemap ${index}...`);
  const res = await httpReq({
    hostname: 'www.officedepot.com',
    path: `/product_sitemap_${index}.xml`,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/xml,application/xml',
    },
  });
  console.log(`    → HTTP ${res.status}, body length: ${res.body.length}`);
  if (res.status !== 200) throw new Error(`Sitemap HTTP ${res.status}`);
  const urls = res.body.match(/https:\/\/www\.officedepot\.com\/a\/products\/[^<\s"]+/g) || [];
  return urls.map(u => u.split('?')[0].replace(/\/$/, '') + '/');
}

// ─── OD product API call (GraphQL, no proxy) ──────────────────────────────────
function buildGql(sku, visitorId) {
  return `{ getData(sku: "${sku}", site: "OD", store: "3379", src: "sku-page-1727909732053", couponCode: "", hidePrice: false, regionId: "", customerEnteredSku: "${sku}", isMarketplaceSku: false, slotIds: [10230], retailerVisitorId: "${visitorId}", fwdFor: "99.89.80.196") { catalog { title sku upc brand images scene7ImageUrl breadcrumbs { description } } skuDetails { skuId: sku quantity skuDisplayAllowedFlag price { sellPrice { price formattedPrice } regularPrice { price formattedPrice } } } } }`;
}

async function scrapeOdProduct(url, session) {
  const skuMatch = url.match(/\/a\/products\/(\d+)\//);
  if (!skuMatch) return null;
  const sku     = skuMatch[1];
  const payload = JSON.stringify({ query: buildGql(sku, session.visitorId), variables: null });

  const res = await httpReq({
    method:   'POST',
    hostname: 'www.officedepot.com',
    path:     '/sku-details-service/skuinfo',
    headers: {
      'accept':              'application/json',
      'content-type':        'application/json',
      'content-length':      Buffer.byteLength(payload),
      'origin':              'https://www.officedepot.com',
      'referer':             url,
      'user-agent':          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      'accept-encoding':     'gzip, deflate, br',
      'accept-language':     'en-US,en;q=0.9',
      'isaccesstoken':       'false',
      'isbloomreachenabled': 'false',
      'trxid':               `${sku}-${crypto.randomUUID()}`,
      'sec-fetch-dest':      'empty',
      'sec-fetch-mode':      'cors',
      'sec-fetch-site':      'same-origin',
      'jwt':                 session.jwt,
      'cookie':              session.cookieStr,
    },
    body: payload,
  });

  if (res.status !== 200) return { error: `HTTP ${res.status}`, sku, url };

  let data;
  try { data = JSON.parse(res.body); } catch { return { error: 'JSON parse error', sku, url }; }

  if (data?.hasErrorResponse === 'true') return { error: data?.errorResponse?.errorMessage || 'API error', sku, url };

  const catalog = data?.data?.getData?.catalog || {};
  const details = data?.data?.getData?.skuDetails || {};
  const price   = details?.price || {};

  const currentPrice  = price?.sellPrice?.price   || null;
  const regularPrice  = price?.regularPrice?.price || null;
  const imageUrl      = catalog?.scene7ImageUrl    || (catalog?.images?.[0]) || null;
  const name          = catalog?.title             || null;
  const brand         = catalog?.brand             || null;
  const upc           = catalog?.upc               || null;

  return { sku, url, name, brand, upc, currentPrice, regularPrice, imageUrl, status: res.status };
}

// ─── Filter: physical merchandise keywords ────────────────────────────────────
const INCLUDE = ['laptop','notebook','chromebook','computer','desktop','monitor','display',
  'printer','copier','scanner','shredder','laminator','chair','desk','table','cabinet',
  'shelv','bookcase','ergonomic','standing','tablet','ipad','keyboard','mouse','webcam',
  'headphone','headset','speaker','microphone','router','modem','hard-drive','-ssd-',
  '-ssd','flash-drive','usb-drive','external-drive','projector','coffee-maker','keurig',
  'espresso','tv-','-tv-','television','toner','ink-cartridge'];
const EXCLUDE = ['copies','manuals','resumes','brochures','posters','flyers','banners',
  'custom-','same-day','spiral-bound','adhesive-poster','blueprint','menus','newsletters'];

function isPhysical(url) {
  const m = url.toLowerCase().match(/\/a\/products\/\d+\/([^/?#]+)/);
  if (!m) return false;
  const seg = m[1];
  if (EXCLUDE.some(e => seg.startsWith(e))) return false;
  return INCLUDE.some(kw => seg.includes(kw));
}

// ─── DB write (only when --save) ─────────────────────────────────────────────
async function saveToDb(product) {
  const { query } = require('../src/config/database');
  const { saveProductData } = require('../src/services/scraperBase');

  const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', ['office-depot']);
  const storeId  = storeRes.rows[0]?.id;
  if (!storeId) throw new Error('Store office-depot not found in DB');

  const catsRes = await query('SELECT id, slug FROM categories');
  const catMap  = {};
  for (const r of catsRes.rows) catMap[r.slug] = r.id;
  const defaultId = catMap['electronics'] || Object.values(catMap)[0];

  function detectCat(name, url) {
    const t = (name + ' ' + url).toLowerCase();
    if (/chair|desk|table|shelv|cabinet|bookcase|stand|mat|storage|furniture/.test(t)) return catMap['home-decor'] || defaultId;
    if (/printer|toner|ink|shredder|laminator|paper|binder|staple|copier/.test(t)) return catMap['office'] || defaultId;
    if (/coffee|keurig|espresso|refrigerator|microwave|toaster|blender/.test(t)) return catMap['appliances'] || defaultId;
    return defaultId;
  }

  const sku   = product.sku || `od-${Date.now()}`;
  const catId = detectCat(product.name || '', product.url || '');

  const res = await query(`
    INSERT INTO products (name, brand, sku, upc, store_id, category_id, image_url, product_url, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
    ON CONFLICT (sku, store_id) DO UPDATE SET
      name=EXCLUDED.name,
      brand=COALESCE(EXCLUDED.brand,products.brand),
      image_url=COALESCE(EXCLUDED.image_url,products.image_url),
      product_url=COALESCE(EXCLUDED.product_url,products.product_url),
      updated_at=NOW()
    RETURNING *
  `, [
    product.name || `OD ${sku}`,
    product.brand || null,
    sku,
    product.upc   || null,
    storeId,
    catId,
    product.imageUrl || null,
    product.url,
  ]);

  const dbProduct = res.rows[0];

  const scraped = {
    name:         product.name,
    brand:        product.brand,
    sku,
    upc:          product.upc,
    currentPrice: parseFloat(product.currentPrice),
    regularPrice: product.regularPrice ? parseFloat(product.regularPrice) : null,
    imageUrl:     product.imageUrl,
    productUrl:   product.url,
  };

  await saveProductData(dbProduct, scraped, 'office-depot');
  return dbProduct;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const results = { total: 0, withPrice: 0, onSale: 0, noPrice: 0, errors: 0, blocked: false, saved: 0 };

  // Step 1: get JWT
  let session;
  try {
    session = await getOdSession();
  } catch (e) {
    console.error(`\n❌ BLOCKED: Cannot get OD JWT — ${e.message}`);
    console.error('→ OD requires proxy for session fetch. Stopping.');
    results.blocked = true;
    return results;
  }

  // Step 2: fetch sitemap
  let sitemapUrls;
  try {
    sitemapUrls = await fetchSitemap(0);
    console.log(`    → ${sitemapUrls.length} total URLs`);
  } catch (e) {
    console.error(`\n❌ BLOCKED: Sitemap fetch failed — ${e.message}`);
    results.blocked = true;
    return results;
  }

  // Step 3: filter physical merchandise
  const physical = [...new Set(sitemapUrls.filter(isPhysical))];
  console.log(`[3] Physical merchandise candidates: ${physical.length}`);

  // Step 4: skip known DB URLs if saving
  let toTest = physical;
  if (!DRY) {
    try {
      const { query } = require('../src/config/database');
      const knownRes  = await query(
        'SELECT product_url FROM products WHERE store_id=(SELECT id FROM stores WHERE slug=$1) AND product_url=ANY($2)',
        ['office-depot', physical.slice(0, Math.min(MAX * 10, physical.length))]
      );
      const known = new Set(knownRes.rows.map(r => r.product_url));
      toTest = physical.filter(u => !known.has(u));
      console.log(`    → ${toTest.length} not yet in DB`);
    } catch (e) {
      console.warn(`    → DB check skipped: ${e.message}`);
    }
  }

  toTest = toTest.slice(0, MAX);
  console.log(`[4] Testing ${toTest.length} products (max=${MAX}):\n`);

  for (let i = 0; i < toTest.length; i++) {
    const url = toTest[i];
    process.stdout.write(`  [${i + 1}/${toTest.length}] `);

    let p;
    try {
      p = await scrapeOdProduct(url, session);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.errors++;
      if (e.message.includes('403') || e.message.includes('429') || e.message.includes('blocked')) {
        console.log('\n  ❌ BLOCKED — stopping test');
        results.blocked = true;
        break;
      }
      continue;
    }

    results.total++;

    if (p.error) {
      if (p.error.includes('HTTP 403') || p.error.includes('HTTP 429') || p.error.includes('HTTP 407')) {
        console.log(`  ❌ BLOCKED (${p.error}) — stopping`);
        results.blocked = true;
        break;
      }
      console.log(`  ⚠️  ${p.sku} → ERROR: ${p.error}`);
      results.errors++;
      continue;
    }

    if (!p.currentPrice) {
      console.log(`  ⏭️  ${p.sku} → no price`);
      results.noPrice++;
      continue;
    }

    results.withPrice++;
    if (p.regularPrice) results.onSale++;
    const saleTag = p.regularPrice ? ` (was $${p.regularPrice})` : '';
    const imgTag  = p.imageUrl ? ' 🖼️' : '';
    console.log(`  ✅ ${p.sku} → $${p.currentPrice}${saleTag} | ${(p.name || '').slice(0, 50)}${imgTag}`);

    if (!DRY && p.currentPrice) {
      try {
        await saveToDb(p);
        results.saved++;
      } catch (e) {
        console.log(`     ⚠️ DB save failed: ${e.message}`);
      }
    }

    // Small delay to avoid rate limiting
    if (i < toTest.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('RESULTS:');
  console.log(`  Total tested : ${results.total}`);
  console.log(`  With price   : ${results.withPrice}`);
  console.log(`  On sale      : ${results.onSale}`);
  console.log(`  No price     : ${results.noPrice}`);
  console.log(`  Errors       : ${results.errors}`);
  console.log(`  Blocked      : ${results.blocked}`);
  if (!DRY) console.log(`  Saved to DB  : ${results.saved}`);
  console.log(`  Proxy used   : NONE ✅`);
  console.log(`${'─'.repeat(60)}\n`);

  if (!results.blocked && results.withPrice > 0) {
    const hitRate = Math.round((results.withPrice / results.total) * 100);
    console.log(`✅ SUCCESS — OD works without proxy! Hit rate: ${hitRate}%`);
    console.log('→ Can modify runOfficeDepotDiscovery() to skip proxy when PROXY_KILL_SWITCH=true');
  } else if (results.blocked) {
    console.log('❌ OD blocks direct requests — proxy required');
  }

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

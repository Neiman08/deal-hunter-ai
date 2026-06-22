/**
 * bb-api-discovery.js
 *
 * Best Buy product discovery via the official BB Developer REST API.
 * NO Playwright. NO BrightData. NO browser fingerprinting.
 *
 * Requires: BESTBUY_API_KEY in .env
 *   → Register free at: https://developer.bestbuy.com/
 *   → Free tier: 50,000 requests/day, 5 req/second
 *
 * --dry-run  (default) : fetch + print, no DB writes
 * --save               : write products/deals to DB
 * --max N              : max products to test (default 10)
 * --backfill           : fill image_url for existing BB products with bestbuy_sku
 *
 * Usage:
 *   node scripts/bb-api-discovery.js
 *   node scripts/bb-api-discovery.js --max 10 --save
 *   node scripts/bb-api-discovery.js --backfill --save
 */

require('dotenv').config();
const https = require('https');

// ─── CLI flags ────────────────────────────────────────────────────────────────
const argv     = process.argv.slice(2);
const DRY      = !argv.includes('--save');
const BACKFILL = argv.includes('--backfill');
const MAX      = parseInt((argv[argv.indexOf('--max') + 1]) || '10', 10) || 10;

const API_KEY  = process.env.BESTBUY_API_KEY;

console.log(`\n${'═'.repeat(60)}`);
console.log(`BB API DISCOVERY  |  max=${MAX}  |  ${DRY ? 'DRY RUN' : '✅ SAVE'}  |  backfill=${BACKFILL}`);
if (!API_KEY) {
  console.log('\n❌ BESTBUY_API_KEY not set in .env');
  console.log('\nTo get a free API key:');
  console.log('  1. Go to https://developer.bestbuy.com/');
  console.log('  2. Click "Get API Key"');
  console.log('  3. Register with your email');
  console.log('  4. Add BESTBUY_API_KEY=your_key_here to backend/.env');
  console.log('  5. Re-run this script\n');
  process.exit(1);
}
console.log(`  API key: ${API_KEY.slice(0, 8)}...`);
console.log(`${'═'.repeat(60)}\n`);

// ─── BB API helper ────────────────────────────────────────────────────────────
function bbApiGet(path) {
  return new Promise((resolve, reject) => {
    const url     = `https://api.bestbuy.com${path}`;
    const options = {
      hostname: 'api.bestbuy.com',
      path,
      method:   'GET',
      headers:  {
        'User-Agent': 'Mozilla/5.0',
        'Accept':     'application/json',
      },
      rejectUnauthorized: false,
      timeout: 15000,
    };
    const req = https.get(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`BB API HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('JSON parse error')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── BB category IDs for sale products ───────────────────────────────────────
// Best Buy category IDs used in filter queries
const CATEGORIES = [
  { id: 'abcat0502000', name: 'TVs' },
  { id: 'abcat0401000', name: 'Laptops' },
  { id: 'abcat0204000', name: 'Headphones' },
  { id: 'abcat0208000', name: 'Speakers' },
  { id: 'pcmcat193100050008', name: 'Tablets' },
  { id: 'abcat0106000', name: 'Cameras' },
  { id: 'abcat0520002', name: 'Monitors' },
  { id: 'pcmcat138100050001', name: 'Appliances' },
];

// ─── Search for on-sale products via BB API ───────────────────────────────────
async function searchOnSale(categoryId, pageSize = 10) {
  const fields = 'sku,name,salePrice,regularPrice,image,url,active,onSale,inStoreAvailability,categoryPath.id,categoryPath.name,brand,upc';
  const filter = encodeURIComponent(`categoryPath.id=${categoryId}&active=true&onSale=true`);
  const path   = `/v1/products(${filter})?apiKey=${API_KEY}&show=${fields}&format=json&pageSize=${pageSize}`;
  return bbApiGet(path);
}

// ─── Get product by SKU (for backfill) ───────────────────────────────────────
async function getProductBySku(sku) {
  const fields = 'sku,name,salePrice,regularPrice,image,url,active,onSale,brand,upc,categoryPath.name';
  const path   = `/v1/products/${sku}.json?apiKey=${API_KEY}&show=${fields}&format=json`;
  return bbApiGet(path);
}

// ─── Category detection ───────────────────────────────────────────────────────
function detectCategory(product, catMap) {
  const path  = (product.categoryPath || []).map(c => c.name).join(' ').toLowerCase();
  const name  = (product.name || '').toLowerCase();
  const t     = name + ' ' + path;
  if (/laptop|notebook|chromebook|computer/.test(t)) return catMap['electronics'] || catMap['computers'];
  if (/tv|television/.test(t)) return catMap['electronics'];
  if (/headphone|speaker|audio/.test(t)) return catMap['electronics'];
  if (/tablet|ipad/.test(t)) return catMap['electronics'];
  if (/camera|photo/.test(t)) return catMap['electronics'];
  if (/appliance|refrigerator|washer|dryer/.test(t)) return catMap['appliances'];
  return catMap['electronics'] || Object.values(catMap)[0];
}

// ─── DB save ─────────────────────────────────────────────────────────────────
async function saveToDb(product, catId, storeId) {
  const { query } = require('../src/config/database');
  const { saveProductData } = require('../src/services/scraperBase');

  const sku = String(product.sku);

  const res = await query(`
    INSERT INTO products (name, brand, sku, upc, bestbuy_sku, store_id, category_id, image_url, product_url, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
    ON CONFLICT (sku, store_id) DO UPDATE SET
      name=EXCLUDED.name,
      brand=COALESCE(EXCLUDED.brand,products.brand),
      bestbuy_sku=COALESCE(EXCLUDED.bestbuy_sku,products.bestbuy_sku),
      image_url=COALESCE(EXCLUDED.image_url,products.image_url),
      product_url=COALESCE(EXCLUDED.product_url,products.product_url),
      updated_at=NOW()
    RETURNING *
  `, [
    product.name,
    product.brand || null,
    `bb-${sku}`,
    product.upc   || null,
    sku,
    storeId,
    catId,
    product.image || null,
    product.url   || `https://www.bestbuy.com/site/searchpage.jsp?st=${sku}`,
  ]);

  const dbProduct = res.rows[0];
  const scraped   = {
    name:         product.name,
    brand:        product.brand,
    sku:          `bb-${sku}`,
    upc:          product.upc,
    currentPrice: parseFloat(product.salePrice || product.regularPrice),
    regularPrice: product.onSale ? parseFloat(product.regularPrice) : null,
    imageUrl:     product.image || null,
    productUrl:   product.url,
  };

  if (scraped.currentPrice) await saveProductData(dbProduct, scraped, 'best-buy');
  return dbProduct;
}

// ─── Backfill mode: update image_url for existing products ────────────────────
async function runBackfill() {
  const { query } = require('../src/config/database');

  const res = await query(`
    SELECT p.id, p.bestbuy_sku, p.name
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'best-buy' AND p.bestbuy_sku IS NOT NULL AND p.image_url IS NULL
    ORDER BY p.created_at DESC
    LIMIT $1
  `, [MAX]);

  const skus = res.rows;
  console.log(`[BACKFILL] ${skus.length} BB products with SKU but no image_url\n`);

  let updated = 0;
  for (let i = 0; i < skus.length; i++) {
    const { id, bestbuy_sku, name } = skus[i];
    process.stdout.write(`  [${i + 1}/${skus.length}] SKU ${bestbuy_sku} — `);

    let product;
    try {
      product = await getProductBySku(bestbuy_sku);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      if (e.message.includes('403') || e.message.includes('401')) {
        console.log('\n❌ API key invalid or quota exceeded');
        break;
      }
      continue;
    }

    const imageUrl = product.image || null;
    console.log(`${imageUrl ? '🖼️  ' + imageUrl.slice(0, 70) : '(no image)'}`);

    if (!DRY && imageUrl) {
      await query('UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2', [imageUrl, id]);
      updated++;
    }

    if (i < skus.length - 1) await new Promise(r => setTimeout(r, 250)); // 4 req/s (under 5 limit)
  }

  console.log(`\n  Updated: ${updated}/${skus.length}${DRY ? ' (DRY RUN)' : ''}\n`);
  return { updated, total: skus.length };
}

// ─── Discovery mode: find new on-sale products ────────────────────────────────
async function runDiscovery(storeId, catMap) {
  let found = 0, saved = 0;
  const perCat = Math.max(1, Math.ceil(MAX / CATEGORIES.length));

  for (const cat of CATEGORIES) {
    if (found >= MAX) break;
    console.log(`\n[CAT] ${cat.name} (${cat.id})`);

    let data;
    try {
      data = await searchOnSale(cat.id, Math.min(perCat, MAX - found));
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      if (e.message.includes('403') || e.message.includes('401')) {
        console.log('  ❌ API key error — stopping');
        break;
      }
      continue;
    }

    const products = data.products || [];
    console.log(`  → ${products.length} on-sale products found`);

    for (const p of products) {
      if (found >= MAX) break;
      found++;
      const discount = p.regularPrice > 0
        ? Math.round(((p.regularPrice - p.salePrice) / p.regularPrice) * 100)
        : 0;
      const imgTag = p.image ? ' 🖼️' : '';
      console.log(`  [${found}] SKU ${p.sku} | $${p.salePrice} (was $${p.regularPrice}, ${discount}% off) | ${(p.name || '').slice(0, 45)}${imgTag}`);

      if (!DRY) {
        try {
          const catId = detectCategory(p, catMap);
          await saveToDb(p, catId, storeId);
          saved++;
        } catch (e) {
          console.log(`    ⚠️ Save error: ${e.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 200));
    }
  }

  return { found, saved };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Verify API key works
  console.log('[1] Verifying BB API key...');
  try {
    const test = await bbApiGet(`/v1/products/6588349.json?apiKey=${API_KEY}&show=sku,name,salePrice&format=json`);
    console.log(`    → OK: ${test.name} ($${test.salePrice})\n`);
  } catch (e) {
    console.error(`\n❌ API key test failed: ${e.message}`);
    if (e.message.includes('403') || e.message.includes('401')) {
      console.error('→ Invalid API key or not yet activated (registration can take a few minutes)');
    }
    process.exit(1);
  }

  if (BACKFILL) {
    await runBackfill();
    process.exit(0);
  }

  // Discovery mode
  let storeId, catMap;
  if (!DRY) {
    const { query } = require('../src/config/database');
    const sRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', ['best-buy']);
    storeId    = sRes.rows[0]?.id;
    if (!storeId) { console.error('Store best-buy not found'); process.exit(1); }
    const cRes = await query('SELECT id, slug FROM categories');
    catMap     = {};
    for (const r of cRes.rows) catMap[r.slug] = r.id;
  }

  console.log('[2] Searching for on-sale BB products...');
  const { found, saved } = await runDiscovery(storeId, catMap || {});

  console.log(`\n${'─'.repeat(60)}`);
  console.log('RESULTS:');
  console.log(`  Products found : ${found}`);
  console.log(`  Saved to DB    : ${saved}${DRY ? ' (DRY RUN — use --save to write)' : ''}`);
  console.log(`  Proxy used     : NONE ✅`);
  console.log(`${'─'.repeat(60)}\n`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

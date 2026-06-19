/**
 * seed-multi-store.js — Seeds realistic products for Home Depot, Lowe's, Staples
 * using public HTTP sitemaps / APIs. No Playwright, no proxy required.
 *
 * Run: node src/db/seed-multi-store.js
 * Safe to run multiple times (ON CONFLICT DO NOTHING / DO UPDATE).
 */
require('dotenv').config();
process.env.PROXY_ENABLED = 'false'; // never use proxy in seed scripts

const https = require('https');
const http  = require('http');
const { query } = require('../config/database');
const { saveProductData } = require('../services/scraperBase');
const logger = require('../utils/logger');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── HTTP fetch helper ─────────────────────────────────────────────────────────
function fetchText(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const opts = {
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    };
    const req = lib.get(url, opts, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Save helper ───────────────────────────────────────────────────────────────
async function saveProduct(storeSlug, productData, categorySlug = 'electronics') {
  const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [storeSlug]);
  const storeId  = storeRes.rows[0]?.id;
  if (!storeId) throw new Error(`Store not found: ${storeSlug}`);

  const catRes = await query('SELECT id FROM categories WHERE slug=$1 LIMIT 1', [categorySlug]);
  const catId  = catRes.rows[0]?.id;

  const { name, brand, sku, upc, image_url, product_url, currentPrice, regularPrice, discountPct } = productData;

  const existing = await query(
    'SELECT id FROM products WHERE product_url=$1 AND store_id=$2 LIMIT 1',
    [product_url, storeId]
  );

  let dbProduct;
  if (existing.rows[0]) {
    dbProduct = existing.rows[0];
  } else {
    const ins = await query(
      `INSERT INTO products (name, brand, sku, upc, store_id, category_id, image_url, product_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (sku, store_id) DO UPDATE SET
         name=EXCLUDED.name, image_url=COALESCE(EXCLUDED.image_url,products.image_url),
         product_url=COALESCE(EXCLUDED.product_url,products.product_url), updated_at=NOW()
       RETURNING id`,
      [name, brand||null, sku, upc||null, storeId, catId, image_url||null, product_url]
    );
    dbProduct = ins.rows[0];
  }

  if (!dbProduct?.id) return null;

  await saveProductData(
    { id: dbProduct.id, cat_slug: categorySlug },
    {
      name,
      brand,
      sku,
      upc,
      currentPrice,
      regularPrice,
      discountPercent: discountPct,
      imageUrl: image_url,
      productUrl: product_url,
      inStock: true,
      source: 'http-seed',
    },
    storeSlug
  );
  return dbProduct.id;
}

// ─── Staples sitemap ───────────────────────────────────────────────────────────
async function seedStaples() {
  console.log('\n📎 Seeding Staples via sitemap...');
  const SITEMAPS = [
    'https://www.staples.com/sbd/content/sitemap/sitemap_1.xml',
    'https://www.staples.com/sbd/content/sitemap/sitemap_2.xml',
  ];

  const INCLUDE = ['laptop', 'printer', 'monitor', 'keyboard', 'mouse', 'chair', 'desk',
    'shredder', 'scanner', 'headphone', 'webcam', 'speaker', 'tablet', 'router', 'hard-drive',
    'ups', 'surge', 'coffee', 'projector', 'toner', 'ink'];

  let allUrls = [];
  for (const sitemapUrl of SITEMAPS) {
    try {
      const xml = await fetchText(sitemapUrl);
      const urls = xml.match(/https:\/\/www\.staples\.com\/[^<\s"]+\/product_[^<\s"]+/g) || [];
      allUrls = allUrls.concat(urls.filter(u => INCLUDE.some(kw => u.toLowerCase().includes(kw))));
      console.log(`  Staples sitemap ${sitemapUrl}: ${urls.length} product URLs, ${allUrls.length} filtered`);
    } catch (e) {
      console.log(`  Staples sitemap failed: ${e.message}`);
    }
  }

  const toProcess = [...new Set(allUrls)].slice(0, 150);
  console.log(`  Processing ${toProcess.length} Staples URLs...`);

  const { scrapeStaplesProduct } = require('../services/scrapers/staples');
  let saved = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const url = toProcess[i];
    try {
      const data = await scrapeStaplesProduct(url);
      if (data?.currentPrice) {
        await saveProduct('staples', { ...data, product_url: url, sku: data.sku || `stpl-${i}` }, 'office');
        saved++;
        if (saved % 10 === 0) console.log(`  Staples: saved ${saved}/${toProcess.length}`);
      }
    } catch (e) {
      errors++;
    }
    await sleep(500);
  }
  console.log(`  ✅ Staples: saved=${saved} errors=${errors}`);
  return { saved, errors };
}

// ─── Lowe's sitemap (HTTP — no proxy needed for sitemap files) ────────────────
async function seedLowes() {
  console.log("\n🔨 Seeding Lowe's via sitemap...");

  const INCLUDE_KEYWORDS = [
    'drill', 'saw', 'grinder', 'sander', 'nailer', 'router', 'impact-driver',
    'mower', 'blower', 'trimmer', 'chainsaw', 'pressure-washer',
    'refrigerator', 'washer', 'dryer', 'dishwasher', 'range', 'freezer',
    'generator', 'air-conditioner', 'dehumidifier', 'air-purifier',
    'dewalt', 'milwaukee', 'makita', 'bosch', 'ridgid', 'ryobi', 'craftsman',
    'tool-chest', 'workbench', 'shop-vac', 'vacuum', 'smart-thermostat',
  ];

  const sitemapIdx = Math.floor(Date.now() / (30 * 60 * 1000)) % 401;
  const sitemapUrl = `https://www.lowes.com/sitemap/detail${sitemapIdx}.xml`;

  let xml;
  try {
    xml = await fetchText(sitemapUrl);
    console.log(`  Lowe's sitemap ${sitemapIdx}: fetched ${xml.length} bytes`);
  } catch (e) {
    console.log(`  Lowe's sitemap failed: ${e.message}`);
    return { saved: 0, errors: 1 };
  }

  const allUrls = (xml.match(/https:\/\/www\.lowes\.com\/pd\/[^<\s"]+/g) || []).map(u => u.split('?')[0]);
  const filtered = [...new Set(allUrls.filter(u => INCLUDE_KEYWORDS.some(kw => u.toLowerCase().includes(kw))))];
  const toProcess = filtered.slice(0, 100);

  console.log(`  Lowe's: ${allUrls.length} total URLs, ${filtered.length} filtered, ${toProcess.length} to process`);

  const { scrapeLowesProduct } = require('../services/scrapers/lowes');
  let saved = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const url = toProcess[i];
    try {
      const data = await scrapeLowesProduct(url);
      if (data?.currentPrice && data.regularPrice) {
        const categorySlug = url.toLowerCase().includes('refrigerator') || url.toLowerCase().includes('washer') ||
          url.toLowerCase().includes('dryer') || url.toLowerCase().includes('range') ? 'appliances' :
          url.toLowerCase().includes('air-conditioner') || url.toLowerCase().includes('generator') ? 'appliances' :
          'hand-tools';
        await saveProduct('lowes', { ...data, product_url: url, sku: data.sku || `lwes-${i}` }, categorySlug);
        saved++;
        if (saved % 10 === 0) console.log(`  Lowe's: saved ${saved}/${toProcess.length}`);
      }
    } catch (e) {
      errors++;
    }
    await sleep(800);
  }
  console.log(`  ✅ Lowe's: saved=${saved} errors=${errors}`);
  return { saved, errors };
}

// ─── Nordstrom Rack (HTTP-accessible category pages) ─────────────────────────
async function seedNordstromRack() {
  console.log('\n👗 Seeding Nordstrom Rack...');
  const { runNordstromRackDiscovery } = require('../services/discovery/nordstromRackDiscovery');
  try {
    const result = await runNordstromRackDiscovery({ maxTotal: 100, maxPerPage: 30, delayMs: 1500 });
    console.log(`  ✅ Nordstrom Rack: saved=${result.saved} errors=${result.errors}`);
    return result;
  } catch (e) {
    console.log(`  ❌ Nordstrom Rack failed: ${e.message}`);
    return { saved: 0, errors: 1 };
  }
}

// ─── Office Depot extra run (all sitemaps) ────────────────────────────────────
async function seedOfficeDepotExtra() {
  console.log('\n📦 Running extra Office Depot discovery (all sitemaps)...');
  const { runOfficeDepotDiscovery } = require('../services/discovery/officeDepotDiscovery');
  try {
    const result = await runOfficeDepotDiscovery({ maxTotal: 500, delayMs: 600 });
    console.log(`  ✅ Office Depot: saved=${result.saved} urls_new=${result.urls_new}`);
    return result;
  } catch (e) {
    console.log(`  ❌ Office Depot failed: ${e.message}`);
    return { saved: 0, errors: 1 };
  }
}

// ─── Macy's via HTTP direct API ───────────────────────────────────────────────
async function seedMacysViaAPI() {
  console.log("\n👗 Seeding Macy's via direct API...");
  // Macy's has a public search API: /xapi/digital/v1/content/6/72/productSearch
  const SEARCH_TERMS = [
    { term: 'clearance+handbag',   category: 'handbags' },
    { term: 'clearance+shoes',     category: 'shoes' },
    { term: 'clearance+dress',     category: 'clothing' },
    { term: 'sale+jewelry',        category: 'jewelry' },
    { term: 'clearance+coat',      category: 'clothing' },
    { term: 'clearance+sneakers',  category: 'shoes' },
    { term: 'sale+watch',          category: 'jewelry' },
    { term: 'clearance+perfume',   category: 'health-beauty' },
    { term: 'clearance+bedding',   category: 'bedding' },
    { term: 'clearance+cookware',  category: 'kitchen' },
  ];

  const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', ['macys']);
  const storeId  = storeRes.rows[0]?.id;
  if (!storeId) { console.log('  Macy\'s store not found'); return { saved: 0 }; }

  let saved = 0, errors = 0;

  for (const { term, category } of SEARCH_TERMS) {
    try {
      const apiUrl = `https://www.macys.com/xapi/digital/v1/content/6/72/productSearch?keyword=${term}&pageSize=30&pageIndex=1&sortBy=PRICE_DISCOUNT&viewType=GRID`;
      const raw = await fetchText(apiUrl);
      const data = JSON.parse(raw);
      const products = data?.searchResponse?.products || data?.products || [];

      console.log(`  Macy's "${term}": ${products.length} products`);

      const catRes = await query('SELECT id FROM categories WHERE slug=$1 LIMIT 1', [category]);
      const catId  = catRes.rows[0]?.id;

      for (const p of products) {
        const id       = p.id;
        const name     = p.detail?.name;
        const brand    = p.detail?.brand?.name;
        const sku      = String(id);
        const url      = `https://www.macys.com/shop/product/${name?.toLowerCase().replace(/\s+/g,'-').slice(0,50)}?ID=${id}`;
        const img      = p.imagery?.images?.[0]?.filePath ? `https://slimages.macysassets.com/is/image/MCY/products/${p.imagery.images[0].filePath}` : null;
        const tiers    = p.pricing?.price?.tieredPrice || [];
        const regTier  = tiers.find(t => t.values?.[0]?.type === 'regular');
        const saleTier = tiers.find(t => t.values?.[0]?.type === 'discount');
        const regPrice = regTier?.values?.[0]?.value;
        const salePrice = saleTier?.values?.[0]?.value;

        if (!name || !salePrice || !regPrice || salePrice >= regPrice) continue;
        const discPct = Math.round((1 - salePrice/regPrice) * 100);
        if (discPct < 20) continue;

        try {
          const ins = await query(
            `INSERT INTO products (name, brand, sku, store_id, category_id, image_url, product_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (sku, store_id) DO UPDATE SET
               name=EXCLUDED.name, image_url=COALESCE(EXCLUDED.image_url,products.image_url),
               product_url=COALESCE(EXCLUDED.product_url,products.product_url), updated_at=NOW()
             RETURNING id`,
            [name, brand||null, sku, storeId, catId, img, url]
          );
          const productId = ins.rows[0]?.id;
          if (productId) {
            await saveProductData(
              { id: productId, cat_slug: category },
              { name, brand, sku, currentPrice: salePrice, regularPrice: regPrice,
                discountPercent: discPct, imageUrl: img, productUrl: url, inStock: true, source: 'api-seed' },
              'macys'
            );
            saved++;
          }
        } catch (dbErr) {
          errors++;
        }
      }
    } catch (e) {
      console.log(`  Macy's "${term}" error: ${e.message}`);
      errors++;
    }
    await sleep(400);
  }
  console.log(`  ✅ Macy's API: saved=${saved} errors=${errors}`);
  return { saved, errors };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Multi-store seed starting...\n');
  const results = {};

  // Run in sequence to avoid overwhelming local DB
  results['office-depot'] = await seedOfficeDepotExtra().catch(e => ({ error: e.message }));
  results['macys-api']    = await seedMacysViaAPI().catch(e => ({ error: e.message }));
  results['lowes']        = await seedLowes().catch(e => ({ error: e.message }));
  results['staples']      = await seedStaples().catch(e => ({ error: e.message }));

  const after = await query('SELECT COUNT(*) as active FROM deals WHERE is_active = true');
  console.log(`\n✅ Seed complete. Active deals: ${after.rows[0].active}`);
  console.log('Results:', JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Fatal:', e.message); process.exit(1); });

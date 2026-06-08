/**
 * Office Depot Discovery Engine — Sale-Only Sitemap Strategy
 *
 * OD listing/category pages are fully JS-rendered AND block all browser approaches.
 * Only sitemap + individual product pages are accessible.
 *
 * Strategy:
 *  1. Fetch a random sitemap file (rotating per cycle through all 4 files)
 *  2. Shuffle with a per-cycle seed (changes every 30 min → different products each cycle)
 *  3. For each candidate URL: scrape the product page
 *  4. IF regularPrice is found (product is on sale) → save to DB, activate deal
 *  5. IF no regularPrice (regular price only) → SKIP entirely (don't save to DB)
 *     └─ Skipped products remain "new" → will be re-discovered in future cycles
 *
 * This ensures the DB only accumulates OD products that are genuinely on sale.
 */

const https            = require('https');
const http             = require('http');
const HttpsProxyAgent  = require('https-proxy-agent');
const { shouldSkipStore } = require('../proxyManager');
const { saveProductData } = require('../scraperBase');
const { query }           = require('../../config/database');
const logger  = require('../../utils/logger');

const STORE_SLUG  = 'office-depot';
const STORE_LABEL = 'Office Depot';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PROXY_HOST = process.env.PROXY_HOST || 'brd.superproxy.io';
const PROXY_PORT = parseInt(process.env.PROXY_PORT) || 22225;
const PROXY_USER = process.env.PROXY_USER || '';
const PROXY_PASS = process.env.PROXY_PASS || '';

function makeProxyAgent() {
  console.log(`[Discovery:OfficeDept] PROXY_ENABLED=${process.env.PROXY_ENABLED} ISP_PROXY_ENABLED=${process.env.ISP_PROXY_ENABLED}`);
  console.log(`[Discovery:OfficeDept] PROXY_HOST=${process.env.PROXY_HOST} PROXY_PORT=${process.env.PROXY_PORT}`);
  console.log(`[Discovery:OfficeDept] PROXY_USER=${(process.env.PROXY_USER || '').slice(0, 30)}... hasPass=${!!process.env.PROXY_PASS}`);

  if (process.env.PROXY_ENABLED !== 'true' || !PROXY_USER) {
    console.log(`[Discovery:OfficeDept] DIRECT connection (proxy disabled or no user)`);
    return null;
  }
  try {
    const url  = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
    const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
    const agent = new Ctor(url, { rejectUnauthorized: false });
    console.log(`[Discovery:OfficeDept] Using proxy: ${PROXY_HOST}:${PROXY_PORT}`);
    return agent;
  } catch (e) {
    logger.warn(`[Discovery:${STORE_LABEL}] Proxy agent init failed: ${e.message}`);
    return null;
  }
}

const SITEMAPS = [
  'https://www.officedepot.com/product_sitemap_0.xml',
  'https://www.officedepot.com/product_sitemap_1.xml',
  'https://www.officedepot.com/product_sitemap_2.xml',
  'https://www.officedepot.com/product_sitemap_3.xml',
];

// Keywords in the URL name segment — physical merchandise only
const INCLUDE_KEYWORDS = [
  'laptop', 'notebook', 'chromebook', 'computer', 'desktop',
  'monitor', 'display',
  'printer', 'copier', 'scanner', 'shredder', 'laminator',
  'chair', 'desk', 'table', 'cabinet', 'shelv', 'bookcase', 'ergonomic', 'standing',
  'tablet', 'ipad', 'kindle',
  'keyboard', 'mouse', 'webcam', 'headphone', 'headset',
  'speaker', 'microphone',
  'router', 'modem', 'access-point', 'network-switch',
  'hard-drive', '-ssd-', '-ssd', 'flash-drive', 'usb-drive', 'external-drive',
  'projector', 'whiteboard', 'smartboard',
  'camera',
  'ups-', '-ups-', 'surge-protector', 'power-strip',
  'coffee-maker', 'keurig', 'coffee-machine', 'espresso',
  'tv-', '-tv-', 'television', 'smart-tv',
  'toner', 'ink-cartridge',
];

// Print-service URL prefixes — always exclude (these are services, not products)
const PRINT_SERVICE_PREFIXES = [
  'copies', 'manuals', 'resumes', 'brochures', 'posters', 'flyers',
  'banners', 'custom-', 'same-day', 'spiral-bound', 'adhesive-poster',
  'blueprint', 'menus', 'newsletters', 'door-hangers', 'rack-cards',
  'table-tents', 'yard-signs', 'canvas-prints', 'foam-boards',
  'invitations', 'retractable-banner', 'foam-board', 'a-frame',
];

function fetchText(url, hops = 0, agent = undefined) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  if (hops === 0 && agent === undefined) agent = makeProxyAgent();
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https:') ? https : http;
    const opts = {
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };
    if (agent) opts.agent = agent;
    const req = lib.get(url, opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location, hops + 1, agent).then(resolve).catch(reject);
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
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

function isPhysicalProduct(url) {
  const m = url.toLowerCase().match(/\/a\/products\/\d+\/([^/?#]+)/);
  if (!m) return false;
  const seg = m[1];
  if (PRINT_SERVICE_PREFIXES.some(p => seg.startsWith(p))) return false;
  return INCLUDE_KEYWORDS.some(kw => seg.includes(kw));
}

// Per-cycle deterministic shuffle — changes every 30 min so each cycle gets different products
function cycleShuffled(arr, cycleSeed) {
  const out = [...arr];
  let s = cycleSeed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function runOfficeDepotDiscovery(options = {}) {
  const maxTotal  = options.maxTotal  || 300;
  const delayMs   = options.delayMs   || 2000;
  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 2;

  const stats = {
    store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0, blocked: false, blockType: null,
  };

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    stats.blocked = true; stats.blockType = 'skipped_due_to_failures';
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY (sale-only sitemap)`);
  logger.info(`   maxTotal=${maxTotal} | skip-if-no-sale=enabled`);
  logger.info('═'.repeat(60));

  // Per-cycle seed: changes every 30 min → different shuffle each cycle
  const cycleSeed = Math.floor(Date.now() / (30 * 60 * 1000));
  // Rotate sitemap file: cycle through all 4
  const sitemapIdx = cycleSeed % SITEMAPS.length;
  const sitemapUrl = SITEMAPS[sitemapIdx];

  logger.info(`[Discovery:${STORE_LABEL}] Cycle #${cycleSeed} | Sitemap ${sitemapIdx}: ${sitemapUrl}`);

  let rawXml;
  try {
    rawXml = await fetchText(sitemapUrl);
    stats.pages_visited = 1;
  } catch (err) {
    logger.error(`[Discovery:${STORE_LABEL}] Sitemap fetch failed: ${err.message}`);
    return stats;
  }

  const allUrls = rawXml.match(/https:\/\/www\.officedepot\.com\/a\/products\/[^<\s"]+/g) || [];
  logger.info(`[Discovery:${STORE_LABEL}] Sitemap has ${allUrls.length} total URLs`);

  // Filter to physical merchandise
  const candidates = allUrls
    .map(u => u.split('?')[0].replace(/\/$/, '') + '/')
    .filter(isPhysicalProduct);

  logger.info(`[Discovery:${STORE_LABEL}] ${candidates.length} physical merchandise candidates`);
  stats.urls_discovered = candidates.length;

  if (!candidates.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No candidates found`);
    return stats;
  }

  // Shuffle with per-cycle seed — different order every 30 min
  const shuffled = cycleShuffled(candidates, cycleSeed);

  // Filter out URLs already in DB (skip if already saved as an ON-SALE product)
  // Products without sale prices were NEVER saved → they remain "new" here
  const productRes = await query(
    'SELECT product_url FROM products WHERE store_id = (SELECT id FROM stores WHERE slug=$1) AND product_url = ANY($2)',
    [STORE_SLUG, shuffled.slice(0, Math.min(maxTotal * 8, shuffled.length))]
  ).catch(() => ({ rows: [] }));
  const knownUrls = new Set(productRes.rows.map(r => r.product_url));
  const toProcess = shuffled.filter(u => !knownUrls.has(u)).slice(0, maxTotal);

  stats.urls_new = toProcess.length;
  logger.info(`[Discovery:${STORE_LABEL}] ${toProcess.length} not-yet-saved URLs to scan`);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All sampled URLs already have sale prices saved — rotating next cycle`);
    return stats;
  }

  // Fetch storeId once
  const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [STORE_SLUG]);
  const storeId = storeRes.rows[0]?.id;
  if (!storeId) { logger.error(`[Discovery:${STORE_LABEL}] Store not found in DB`); return stats; }

  // Fetch default category once
  const catRes = await query('SELECT id, slug FROM categories ORDER BY name LIMIT 1');
  const categoryId = catRes.rows[0]?.id || null;
  const catSlug    = catRes.rows[0]?.slug || null;

  const { scrapeOfficeDepotProduct } = require('../scrapers/officedepot');

  logger.info(`\n[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} candidates (sale-only)...`);

  async function scanOneOd(url, idx) {
    logger.info(`[Discovery:${STORE_LABEL}] [${idx + 1}/${toProcess.length}] ${url}`);
    try {
      const scraped = await scrapeOfficeDepotProduct(url);

      if (!scraped?.currentPrice) {
        stats.errors++;
        logger.warn(`[Discovery:${STORE_LABEL}]   ⚠️  No price found`);
        return;
      }

      if (!scraped.regularPrice) {
        // Regular price only — not on sale. Skip entirely (don't save to DB).
        stats.no_price++;
        logger.info(`[Discovery:${STORE_LABEL}]   ⏭️  Regular price only ($${scraped.currentPrice}) — skipping`);
        return;
      }

      // Product is on sale — save to DB
      let dbProduct = null;

      if (url) {
        const existing = await query(
          'SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.product_url=$1 LIMIT 1',
          [url]
        );
        dbProduct = existing.rows[0] || null;
      }

      if (!dbProduct) {
        const skuKey = scraped.sku || `od-${url.match(/\/a\/products\/(\d+)\//)?.[1] || Date.now()}`;
        const inserted = await query(`
          INSERT INTO products (name, brand, sku, upc, store_id, category_id, image_url, product_url, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
          ON CONFLICT (sku, store_id) DO UPDATE SET
            name=EXCLUDED.name,
            brand=COALESCE(EXCLUDED.brand, products.brand),
            image_url=COALESCE(EXCLUDED.image_url, products.image_url),
            product_url=COALESCE(EXCLUDED.product_url, products.product_url),
            updated_at=NOW()
          RETURNING *
        `, [
          scraped.name || `OD Product ${Date.now()}`,
          scraped.brand || null,
          skuKey,
          scraped.upc || null,
          storeId,
          categoryId,
          scraped.imageUrl || null,
          url,
        ]);
        dbProduct = { ...inserted.rows[0], cat_slug: catSlug };
      }

      await saveProductData(dbProduct, scraped, STORE_SLUG);
      stats.saved++;
      logger.info(`[Discovery:${STORE_LABEL}]   ✅ SALE! $${scraped.currentPrice} (was $${scraped.regularPrice}) | "${scraped.name?.slice(0,50) || ''}"`);
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message.slice(0, 100)}`);
    }
    await sleep(delayMs);
  }

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    await Promise.all(
      toProcess.slice(i, i + CONCURRENCY).map((url, j) => scanOneOd(url, i + j))
    );
  }

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   scanned: ${stats.urls_new} | sale_found: ${stats.saved} | regular_only: ${stats.no_price} | errors: ${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  return stats;
}

module.exports = { runOfficeDepotDiscovery, runDiscovery: runOfficeDepotDiscovery };

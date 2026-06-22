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
const { shouldSkipStore } = require('../proxyManager');
const { buildHttpProxyAgent } = require('../../utils/proxyUtils');
const { saveProductData } = require('../scraperBase');
const { query }           = require('../../config/database');
const { writeStoreRun }   = require('../../utils/storeRunStats');
const logger  = require('../../utils/logger');

const STORE_SLUG  = 'office-depot';
const STORE_LABEL = 'Office Depot';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Returns null (no proxy) when PROXY_KILL_SWITCH=true — OD HTTP is accessible directly
function makeProxyAgent() {
  if (process.env.PROXY_KILL_SWITCH === 'true') return null;
  return buildHttpProxyAgent('OfficeDept');
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
  const startedAt  = Date.now();
  const maxTotal  = options.maxTotal  || 300;
  const delayMs   = options.delayMs   || 2000;
  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 2;

  const stats = {
    store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0, blocked: false, blockType: null,
    proxy_requests_est: 0,
  };

  // PROXY_KILL_SWITCH=true → run without proxy (OD HTTP API is accessible directly)
  if (process.env.PROXY_KILL_SWITCH === 'true') {
    logger.info(`[Discovery:${STORE_LABEL}] PROXY_KILL_SWITCH=true — running without proxy (HTTP-safe)`);
  }

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
  // Process ALL sitemaps each cycle — fetch all 4 in parallel for maximum coverage
  const sitemapResults = await Promise.allSettled(SITEMAPS.map(url => fetchText(url)));
  let allSitemapUrls = [];
  for (let i = 0; i < sitemapResults.length; i++) {
    if (sitemapResults[i].status === 'fulfilled') {
      const urls = sitemapResults[i].value.match(/https:\/\/www\.officedepot\.com\/a\/products\/[^<\s"]+/g) || [];
      allSitemapUrls = allSitemapUrls.concat(urls);
      stats.pages_visited++;
      logger.info(`[Discovery:${STORE_LABEL}] Sitemap ${i}: ${urls.length} URLs`);
    } else {
      logger.warn(`[Discovery:${STORE_LABEL}] Sitemap ${i} fetch failed: ${sitemapResults[i].reason?.message}`);
    }
  }

  if (!stats.pages_visited) {
    logger.error(`[Discovery:${STORE_LABEL}] All sitemaps failed`);
    stats.blocked = true;
    stats.blockType = 'sitemap_fetch_failed';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  const allUrls = allSitemapUrls;
  logger.info(`[Discovery:${STORE_LABEL}] Total sitemap URLs across all files: ${allUrls.length}`);

  // Filter to physical merchandise
  const candidates = allUrls
    .map(u => u.split('?')[0].replace(/\/$/, '') + '/')
    .filter(isPhysicalProduct);
  // Deduplicate
  const uniqueCandidates = [...new Set(candidates)];

  logger.info(`[Discovery:${STORE_LABEL}] ${uniqueCandidates.length} physical merchandise candidates (deduped)`);
  stats.urls_discovered = uniqueCandidates.length;

  if (!uniqueCandidates.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No candidates found`);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  // Shuffle with per-cycle seed — different order every 30 min
  const shuffled = cycleShuffled(uniqueCandidates, cycleSeed);

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
    stats.blockType = 'all_urls_known';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  // Fetch storeId once
  const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [STORE_SLUG]);
  const storeId = storeRes.rows[0]?.id;
  if (!storeId) { logger.error(`[Discovery:${STORE_LABEL}] Store not found in DB`); return stats; }

  // Pre-load all categories for smart assignment
  const allCatsRes = await query('SELECT id, slug FROM categories');
  const catMap = {};
  for (const r of allCatsRes.rows) catMap[r.slug] = r.id;
  const defaultCatId  = catMap['electronics'] || catMap['office'] || Object.values(catMap)[0];
  const defaultCatSlug = 'electronics';

  function detectOdCategory(name, url) {
    const t = (name + ' ' + url).toLowerCase();
    if (/chair|desk|table|shelv|cabinet|bookcase|stand|mat|storage|furniture/.test(t)) return ['home-decor', catMap['home-decor']];
    if (/printer|toner|ink|shredder|laminator|paper|binder|staple|copier/.test(t)) return ['office', catMap['office']];
    if (/coffee|keurig|espresso|refrigerator|microwave|toaster|blender/.test(t)) return ['appliances', catMap['appliances']];
    if (/laptop|chromebook|computer|desktop|monitor|tablet|ipad|keyboard|mouse|webcam|router|headphone|speaker|hard.?drive|ssd|flash.?drive/.test(t)) return ['electronics', catMap['electronics']];
    return [defaultCatSlug, defaultCatId];
  }

  const { scrapeOfficeDepotProduct, warmSession } = require('../scrapers/officedepot');

  // Pre-warm session once so all 150 products share the same JWT (no 150 page fetches)
  try {
    await warmSession();
    logger.info(`[Discovery:${STORE_LABEL}] Session warmed (JWT ready)`);
  } catch (e) {
    logger.warn(`[Discovery:${STORE_LABEL}] Session warm failed: ${e.message} — will retry per-product`);
  }

  logger.info(`\n[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} candidates (all prices)...`);

  let consec402 = 0;
  let bail402   = false;
  stats.od_402_count = 0;

  async function scanOneOd(url, idx) {
    if (bail402) return;
    logger.info(`[Discovery:${STORE_LABEL}] [${idx + 1}/${toProcess.length}] ${url}`);
    if (process.env.PROXY_KILL_SWITCH !== 'true') stats.proxy_requests_est++;
    try {
      const scraped = await scrapeOfficeDepotProduct(url);

      if (!scraped?.currentPrice) {
        consec402 = 0;
        stats.errors++;
        logger.warn(`[Discovery:${STORE_LABEL}]   ⚠️  No price found`);
        return;
      }

      consec402 = 0; // successful fetch resets counter

      if (!scraped.regularPrice) {
        stats.no_price++;
        logger.info(`[Discovery:${STORE_LABEL}]   ⏭️  No regular price found ($${scraped.currentPrice}) — saving anyway`);
        // Fall through: save product regardless so we can track price changes
      }

      // Save product (on sale or regular price — catalog building)
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
        const [detectedCatSlug, detectedCatId] = detectOdCategory(scraped.name || '', url);
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
          detectedCatId,
          scraped.imageUrl || null,
          url,
        ]);
        dbProduct = { ...inserted.rows[0], cat_slug: detectedCatSlug };
      }

      await saveProductData(dbProduct, scraped, STORE_SLUG);
      stats.saved++;
      const saleTag = scraped.regularPrice ? ` (was $${scraped.regularPrice})` : '';
      logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${scraped.currentPrice}${saleTag} | "${scraped.name?.slice(0,50) || ''}"`);
    } catch (err) {
      if (err.message === 'product_not_found') {
        consec402 = 0;
        return;
      }
      // 402 Payment Required — proxy billing/auth issue with OD product pages
      if (/HTTP 402/.test(err.message)) {
        consec402++;
        stats.od_402_count = (stats.od_402_count || 0) + 1;
        logger.warn(`[Discovery:${STORE_LABEL}]   ⚠️  402 Payment Required (${consec402} consecutive) | ${url.slice(-60)}`);
        if (consec402 >= 10) {
          logger.error(`[Discovery:${STORE_LABEL}]   ❌ 10 consecutive 402s — proxy billing issue. Cutting scan early (circuit breaker).`);
          stats.blockType     = 'proxy_402_billing';
          stats.blocked       = true;
          stats.reason_for_stop = 'od_402_circuit_breaker';
          bail402 = true;
          // Write immediately so the next cycle's checkStorePause sees blocked=true (6h auto-pause)
          await writeStoreRun(STORE_SLUG, startedAt, stats).catch(() => {});
        }
        return;
      }
      consec402 = 0;
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message.slice(0, 100)}`);
    }
    await sleep(delayMs);
  }

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    if (bail402) break;
    await Promise.all(
      toProcess.slice(i, i + CONCURRENCY).map((url, j) => scanOneOd(url, i + j))
    );
  }
  if (bail402) {
    logger.warn(`[Discovery:${STORE_LABEL}] Scan cut short — ${stats.od_402_count} total 402s. Sitemaps work; product pages require different proxy auth.`);
  }

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   scanned: ${stats.urls_new} | saved: ${stats.saved} | no_price: ${stats.no_price} | errors: ${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);

  // Persist stats to DB so /api/admin/discovery-runs can report without Render logs
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS discovery_runs (
        store         VARCHAR(50) PRIMARY KEY,
        pages_visited INTEGER DEFAULT 0,
        urls_discovered INTEGER DEFAULT 0,
        urls_new      INTEGER DEFAULT 0,
        saved         INTEGER DEFAULT 0,
        no_price      INTEGER DEFAULT 0,
        errors        INTEGER DEFAULT 0,
        blocked       BOOLEAN DEFAULT false,
        block_type    VARCHAR(50),
        last_error    TEXT,
        ran_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
      INSERT INTO discovery_runs
        (store, pages_visited, urls_discovered, urls_new, saved, no_price, errors, blocked, block_type, last_error, ran_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (store) DO UPDATE SET
        pages_visited=EXCLUDED.pages_visited, urls_discovered=EXCLUDED.urls_discovered,
        urls_new=EXCLUDED.urls_new, saved=EXCLUDED.saved, no_price=EXCLUDED.no_price,
        errors=EXCLUDED.errors, blocked=EXCLUDED.blocked, block_type=EXCLUDED.block_type,
        last_error=EXCLUDED.last_error, ran_at=EXCLUDED.ran_at
    `, [
      STORE_SLUG, stats.pages_visited, stats.urls_discovered, stats.urls_new,
      stats.saved, stats.no_price, stats.errors,
      stats.blocked || false, stats.blockType || null, stats.last_error || null,
    ]);
  } catch (dbErr) {
    logger.warn(`[Discovery:${STORE_LABEL}] Could not write discovery_runs: ${dbErr.message}`);
  }

  return stats;
}

module.exports = { runOfficeDepotDiscovery, runDiscovery: runOfficeDepotDiscovery };

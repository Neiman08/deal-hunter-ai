/**
 * Scan Job v5 — Playwright-based
 *
 * Manages the cron schedule, browser lifecycle, per-store scan runs,
 * scan_log DB writes, and post-scan alert processing.
 *
 * Store schedule:
 *   Walmart     — every N min + peak hour boosts (prices change at 6,9,12,15,18,21)
 *   Best Buy    — every N min + morning/evening (less volatile)
 *   Home Depot  — every N min + weekday business hours
 *   Target      — every N min (Phase 2)
 *   Lowe's      — every N min (Phase 2)
 */

const cron   = require('node-cron');
const { query }          = require('../config/database');
const { processAlerts }  = require('../services/notificationService');
const { getBrowser, closeBrowser } = require('../services/browserEngine');
const logger             = require('../utils/logger');
const { saveProductData } = require('../services/scraperBase');

// ─── Lazy-load scrapers (avoids loading Playwright at startup) ────────────────
const getWalmartScraper        = () => require('../services/scrapers/walmart');
const getBestBuyScraper        = () => require('../services/scrapers/bestbuy');
const getHomeDepotScraper      = () => require('../services/scrapers/homedepot');
const getTargetScraper         = () => require('../services/scrapers/target');
const getLowesScraper          = () => require('../services/scrapers/lowes');
const getMacysScraper          = () => require('../services/scrapers/macys');
const getTjmaxxScraper         = () => require('../services/scrapers/tjmaxx');
const getMarshallsScraper      = () => require('../services/scrapers/marshalls');
const getKohlsScraper          = () => require('../services/scrapers/kohls');
const getCostcoScraper         = () => require('../services/scrapers/costco');
const getGameStopScraper       = () => require('../services/scrapers/gamestop');
const getOfficeDepotScraper    = () => require('../services/scrapers/officedepot');
const getStaplesScraper        = () => require('../services/scrapers/staples');
const getNordstromRackScraper  = () => require('../services/scrapers/nordstromrack');
const getHarborFreightScraper  = () => require('../services/scrapers/harborfreight');
const getWayfairScraper        = () => require('../services/scrapers/wayfair');

const STORE_SCRAPERS = {
  'walmart':        () => getWalmartScraper().scanWalmartDeals(),
  'best-buy':       () => getBestBuyScraper().scanBestBuyDeals(),
  'home-depot':     () => getHomeDepotScraper().scanHomeDepotDeals(),
  'target':         () => getTargetScraper().scanTargetDeals(),
  'lowes':          () => getLowesScraper().scanLowesDeals(),
  'macys':          () => getMacysScraper().scanMacysDeals(),
  'tj-maxx':        () => getTjmaxxScraper().scanTjmaxxDeals(),
  'marshalls':      () => getMarshallsScraper().scanMarshallsDeals(),
  'kohls':          () => getKohlsScraper().scanKohlsDeals(),
  'costco':         () => getCostcoScraper().scanCostcoDeals(),
  'gamestop':       () => getGameStopScraper().scanGameStopDeals(),
  'office-depot':   () => getOfficeDepotScraper().scanOfficeDepotDeals(),
  'staples':        () => getStaplesScraper().scanStaplesDeals(),
  'nordstrom-rack': () => getNordstromRackScraper().scanNordstromRackDeals(),
  'harbor-freight': () => getHarborFreightScraper().scanHarborFreightDeals(),
  'wayfair':        () => getWayfairScraper().scanWayfairDeals(),
};

// All available scrapers — enable via ACTIVE_STORES env or run all by default
const ALL_STORES = 'walmart,best-buy,home-depot,target,lowes,macys,tj-maxx,marshalls,kohls,costco,gamestop,office-depot,staples,nordstrom-rack,harbor-freight,wayfair';
const ACTIVE_STORES = (process.env.ACTIVE_STORES || ALL_STORES).split(',').map(s => s.trim());

// Emergency kill-switch: skip all proxy-dependent scans when BrightData is suspended/off-budget
const PROXY_KILL_SWITCH = process.env.PROXY_KILL_SWITCH === 'true';

let isRunning = false;

// ─── Per-store circuit breaker ────────────────────────────────────────────────
// Tracks consecutive failures. After CIRCUIT_THRESHOLD failures the store is
// paused for CIRCUIT_PAUSE_MS so it doesn't burn every 30-min cron slot.
const _circuit = new Map(); // store → { failures: number, pausedUntil: number|null }
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_PAUSE_MS  = 90 * 60 * 1000; // 90 min = 3 cron cycles

function isCircuitOpen(store) {
  const c = _circuit.get(store);
  if (!c) return false;
  if (c.pausedUntil && Date.now() < c.pausedUntil) return true;
  if (c.pausedUntil && Date.now() >= c.pausedUntil) {
    _circuit.set(store, { failures: 0, pausedUntil: null }); // auto-reset
  }
  return false;
}

function recordStoreFailure(store, errMsg) {
  const c = _circuit.get(store) || { failures: 0, pausedUntil: null };
  c.failures++;
  if (c.failures >= CIRCUIT_THRESHOLD && !c.pausedUntil) {
    c.pausedUntil = Date.now() + CIRCUIT_PAUSE_MS;
    logger.warn(`[ScanJob] Circuit TRIPPED for ${store} (${c.failures} consecutive failures) — pausing 90 min`);
  }
  _circuit.set(store, c);
}

function recordStoreSuccess(store) {
  _circuit.set(store, { failures: 0, pausedUntil: null });
}

// ─── Proxy connectivity pre-check ─────────────────────────────────────────────
// Quick test before launching browsers. Returns { ok, error }.
async function checkProxyConnectivity() {
  if (process.env.PROXY_ENABLED !== 'true') return { ok: true, skipped: true };
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT || '22225';
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;
  if (!host || !user || !pass) return { ok: false, error: 'PROXY_HOST/USER/PASS not set' };

  return new Promise(resolve => {
    const net = require('net');
    const sock = net.connect({ host, port: parseInt(port), timeout: 5000 });
    sock.on('connect', () => { sock.destroy(); resolve({ ok: true }); });
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: `TCP timeout connecting to ${host}:${port}` }); });
    sock.on('error',   e  => resolve({ ok: false, error: `TCP error: ${e.message}` }));
  });
}

// ─── Category inference by store + product name ───────────────────────────────
// Returns a category slug from the categories table, or null to use DB default.
function inferCategorySlug(storeSlug, name = '') {
  const n = name.toLowerCase();

  if (storeSlug === 'staples') {
    // Electronics — computers, peripherals, printers
    if (/\blaptop\b|\bchromebook\b|\bmacbook\b/.test(n)) return 'electronics';
    if (/\bmonitor\b|\bdisplay\b|\bwebcam\b/.test(n)) return 'electronics';
    if (/\bkeyboard\b|\bheadset\b|\bheadphones?\b|\bearbuds?\b/.test(n)) return 'electronics';
    if (/\btablet\b|\bipad\b|\bdesktop\b/.test(n)) return 'electronics';
    if (/\bprinter\b(?!\s+paper)|\bscanner\b|\bcopier\b|\bshredder\b/.test(n)) return 'electronics';
    // Office supplies — consumables, paper, stationery
    if (/\btoner\b|\bcartridge\b|\binkjet\b/.test(n)) return 'office';
    if (/\bpaper\b|\bnotepad\b|\bpost.it\b|\bpost it\b|\bsticky note\b/.test(n)) return 'office';
    if (/\bpen\b|\bpencil\b|\bmarker\b|\bsharpie\b|\bhighlighter\b/.test(n)) return 'office';
    if (/\bfolder\b|\bbinder\b|\bfile\b|\bstaple\b|\btape\b|\blabel\b|\benvelope\b/.test(n)) return 'office';
    if (/\bdry.?erase\b|\bwhiteboard\b/.test(n)) return 'office';
    // Furniture
    if (/\bchair\b|\bdesk\b|\bstanding desk\b|\bfurniture\b/.test(n)) return 'home-decor';
    // Cleaning / personal care
    if (/\bsoap\b|\bcleaner\b|\bwipes?\b|\bsanitizer\b|\bdisinfect|\bpaper towel\b/.test(n)) return 'health-beauty';
    // Appliances
    if (/\bkeurig\b|\bcoffee maker\b|\bespresso\b|\bblender\b|\btoaster\b/.test(n)) return 'appliances';
    // Toys / novelty
    if (/\bstress ball\b|\bneedoh\b|\btoy\b/.test(n)) return 'toys';
    // Default for Staples = office (most items are office supplies)
    return 'office';
  }

  return null; // other stores: use existing DB default logic
}

// ─── Main scan orchestrator ───────────────────────────────────────────────────
async function runScan(storeSlug = null) {
  if (isRunning) {
    logger.warn('⚠️  Scan already running — skipping this trigger');
    return { skipped: true };
  }

  isRunning = true;
  const startTime = Date.now();
  const stores    = storeSlug
    ? [storeSlug].filter(s => ACTIVE_STORES.includes(s))
    : ACTIVE_STORES;

  if (!stores.length) {
    logger.warn(`[ScanJob] No active stores match "${storeSlug}"`);
    isRunning = false;
    return { stores_run: 0 };
  }

  logger.info('\n' + '█'.repeat(60));
  logger.info(`[ScanJob] STARTING | stores: ${stores.join(', ')}`);
  logger.info('█'.repeat(60));

  // PROXY_KILL_SWITCH: all scrapers use BrightData (residential or ISP).
  // When the kill-switch is active, abort before browser launch or any proxy call.
  if (PROXY_KILL_SWITCH) {
    stores.forEach(s => logger.warn(`[ScanJob] PROXY_KILL_SWITCH active — skipping scan job for ${s}`));
    isRunning = false;
    return { stores_run: 0, skipped_proxy_kill_switch: true };
  }

  // Create a single scan_log row covering this run
  let logId = null;
  try {
    const logRes = await query(`
      INSERT INTO scan_logs (store_name, status, started_at)
      VALUES ($1, 'running', NOW())
      RETURNING id
    `, ['full-cycle']);
    logId = logRes.rows[0]?.id;
  } catch (err) {
    logger.warn(`[ScanJob] Could not create scan_log: ${err.message}`);
  }

  // Skip browser launch entirely if no active store has a registered Playwright scraper.
  // This avoids the 20s browser pre-check (and any hanging launch) when ACTIVE_STORES
  // is set to 'discovery-only' or any placeholder — the HTTP discovery worker handles deals.
  const scrapableStores = stores.filter(s => STORE_SCRAPERS[s]);
  if (!scrapableStores.length) {
    logger.info(`[ScanJob] No Playwright-scrapable stores in ACTIVE_STORES (${stores.join(',')}) — completing immediately`);
    if (logId) {
      await query(
        `UPDATE scan_logs SET status='success', completed_at=NOW(), duration_seconds=0, products_scanned=0, deals_found=0, errors_count=0 WHERE id=$1`,
        [logId]
      ).catch(() => {});
    }
    isRunning = false;
    return { stores_run: 0 };
  }

  // ── Proxy connectivity pre-check ──────────────────────────────────────────
  // Fail-fast before launching browsers if the proxy TCP port is unreachable.
  // OD (HTTP-based, no browser) is allowed to run even when proxy is down.
  let proxyOk = true;
  if (process.env.PROXY_ENABLED === 'true') {
    const proxyCheck = await checkProxyConnectivity();
    proxyOk = proxyCheck.ok;
    if (!proxyOk) {
      logger.warn(`[ScanJob] Proxy pre-check FAILED: ${proxyCheck.error}`);
      logger.warn('[ScanJob] Playwright scrapers will be skipped — proxy unreachable. OD (HTTP) will still run.');
    } else {
      logger.info('[ScanJob] Proxy pre-check OK');
    }
  }

  // Fast browser availability check — if Playwright can't launch in 20s, abort cleanly
  // instead of letting each store hang for 12 min (which caused 1565s error scans).
  // Skip this check if proxy is already known to be down (browsers would fail anyway).
  let browserReady = false;
  if (proxyOk) {
    const BROWSER_CHECK_MS = 20000;
    try {
      await Promise.race([
        getBrowser(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Browser launch timeout (20s)')), BROWSER_CHECK_MS)),
      ]);
      logger.info('[ScanJob] Playwright browser ready');
      browserReady = true;
    } catch (browserErr) {
      logger.warn(`[ScanJob] Playwright browser unavailable: ${browserErr.message}`);
      logger.warn('[ScanJob] Playwright scrapers will be skipped — OD (HTTP) may still run');
    }
  }

  // If neither browser nor proxy is available, only HTTP-only scrapers (OD) can run.
  // If nothing can run at all, abort early.
  const hasHttpOnlyStores = scrapableStores.includes('office-depot');
  if (!browserReady && !hasHttpOnlyStores) {
    logger.warn('[ScanJob] No browser and no HTTP-only stores — aborting scan');
    if (logId) {
      await query(
        `UPDATE scan_logs SET status='error', completed_at=NOW(), duration_seconds=$1,
         error_details=$2 WHERE id=$3`,
        [Math.round((Date.now() - startTime) / 1000),
         JSON.stringify({ _reason: proxyOk ? 'browser_unavailable' : 'proxy_unreachable' }),
         logId]
      ).catch(() => {});
    }
    isRunning = false;
    return { stores_run: 0, browser_unavailable: true };
  }

  const totals = { scanned: 0, deals: 0, errors: 0 };
  const storeResults = {};
  const storeErrors  = {}; // per-store details written to error_details column

  for (const store of scrapableStores) {
    const scraper = STORE_SCRAPERS[store];
    if (!scraper) {
      logger.warn(`[ScanJob] No scraper registered for "${store}"`);
      continue;
    }

    // Circuit breaker — skip stores that have failed too many times recently
    if (isCircuitOpen(store)) {
      const c = _circuit.get(store);
      const resumeIn = Math.round((c.pausedUntil - Date.now()) / 60000);
      logger.warn(`[ScanJob] ${store} circuit OPEN — skipping (resumes in ~${resumeIn} min)`);
      storeErrors[store] = { status: 'circuit_breaker', resumes_in_min: resumeIn };
      continue;
    }

    // Skip Playwright-dependent scrapers when browser is unavailable
    // OD is HTTP-only and can always run. All other scrapers need a browser.
    const isHttpOnly = (store === 'office-depot');
    if (!browserReady && !isHttpOnly) {
      logger.warn(`[ScanJob] ${store} skipped — browser unavailable`);
      storeErrors[store] = { status: 'skipped_no_browser' };
      continue;
    }

    const storeStart = Date.now();
    logger.info(`\n[ScanJob] ── Starting ${store} ──`);

    const STORE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min per store
    const totalElapsed = Date.now() - startTime;
    const TOTAL_SCAN_CAP_MS = 8 * 60 * 1000; // 8 min total hard cap
    if (totalElapsed > TOTAL_SCAN_CAP_MS) {
      logger.warn(`[ScanJob] Total scan cap reached (${Math.round(totalElapsed/1000)}s) — stopping remaining stores`);
      break;
    }
    try {
      const result = await Promise.race([
        scraper(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`Scan timeout after 3min`)), STORE_TIMEOUT_MS)),
      ]);
      totals.scanned += result.products_scanned || 0;
      totals.deals   += result.deals_found      || 0;
      totals.errors  += result.errors           || 0;
      storeResults[store] = {
        ...result,
        duration_ms: Date.now() - storeStart,
        status: 'success',
      };
      storeErrors[store] = {
        status: 'success',
        products_scanned: result.products_scanned || 0,
        deals_found: result.deals_found || 0,
        errors: result.errors || 0,
        duration_s: Math.round((Date.now() - storeStart) / 1000),
      };
      recordStoreSuccess(store);
      logger.info(`[ScanJob] ${store} done in ${((Date.now() - storeStart) / 1000).toFixed(1)}s`);
    } catch (err) {
      const durS = Math.round((Date.now() - storeStart) / 1000);
      logger.error(`[ScanJob] ${store} FAILED (${durS}s): ${err.message}`);
      totals.errors++;
      recordStoreFailure(store, err.message);
      storeErrors[store] = { status: 'error', error: err.message, duration_s: durS };
      storeResults[store] = { status: 'error', error: err.message, duration_ms: Date.now() - storeStart };
    }
  }

  // Deactivate stale deals — ONLY for stores that the scan job actually ran AND
  // produced results. Scoping to successfully-scanned stores prevents a single
  // successful BB scan from killing OD/Macy's deals that the discovery worker saves.
  // Window extended to 45 days to match the discovery cleanupDeals function.
  if (totals.scanned > 0) {
    const successStores = Object.entries(storeResults)
      .filter(([, r]) => r.status === 'success' && (r.products_scanned || 0) > 0)
      .map(([slug]) => slug);
    if (successStores.length > 0) {
      try {
        const placeholders = successStores.map((_, i) => `$${i + 1}`).join(',');
        const deactivated = await query(
          `UPDATE deals d SET is_active = false
           FROM stores s
           WHERE d.store_id = s.id
             AND s.slug IN (${placeholders})
             AND d.last_seen_at < NOW() - INTERVAL '45 days'
             AND d.is_active = true`,
          successStores
        );
        if (deactivated.rowCount > 0) {
          logger.info(`[ScanJob] Deactivated ${deactivated.rowCount} stale deals for [${successStores.join(',')}]`);
        }
      } catch (err) {
        logger.warn(`[ScanJob] Could not deactivate stale deals: ${err.message}`);
      }
    }
  } else {
    logger.info('[ScanJob] Scan produced 0 products — skipping stale deal cleanup to preserve existing deals');
  }

  // Send alerts for new deals
  if (totals.deals > 0) {
    try {
      const alertsSent = await processAlerts();
      logger.info(`[ScanJob] Alerts processed: ${alertsSent} sent`);
    } catch (err) {
      logger.error(`[ScanJob] Alert processing failed: ${err.message}`);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Determine final status based on store-level exceptions only.
  // Product-level errors within a successful store scan (e.g. OD API throttling
  // 3 of 15 products) don't degrade the overall status — the store ran fine.
  // storeErrors entries with status='error' = store threw an uncaught exception.
  const storeExceptions = Object.values(storeErrors).filter(r => r.status === 'error').length;
  const finalStatus =
    storeExceptions > 0 && totals.scanned === 0 ? 'error' :
    storeExceptions > 0 && totals.scanned > 0   ? 'partial' :
    'success';

  // Update scan_log with per-store details
  if (logId) {
    try {
      await query(`
        UPDATE scan_logs SET
          status           = $1,
          products_scanned = $2,
          deals_found      = $3,
          errors_count     = $4,
          duration_seconds = $5,
          error_details    = $6,
          completed_at     = NOW()
        WHERE id = $7
      `, [
        finalStatus,
        totals.scanned, totals.deals, totals.errors, duration,
        JSON.stringify(storeErrors),
        logId,
      ]);
    } catch (err) {
      logger.warn(`[ScanJob] Could not update scan_log: ${err.message}`);
    }
  }

  logger.info('\n' + '█'.repeat(60));
  logger.info(`[ScanJob] COMPLETE in ${duration}s | status=${finalStatus}`);
  logger.info(`  Scanned: ${totals.scanned} | Deals: ${totals.deals} | Errors: ${totals.errors}`);
  Object.entries(storeErrors).forEach(([store, r]) => {
    const icon = r.status === 'success' ? '✅' : r.status === 'circuit_breaker' ? '🔴' : r.status === 'skipped_no_browser' ? '⏭️ ' : '❌';
    const detail = r.status === 'success'
      ? `scanned=${r.products_scanned} deals=${r.deals_found} (${r.duration_s}s)`
      : r.error || r.status;
    logger.info(`  ${icon} ${store}: ${detail}`);
  });
  logger.info('█'.repeat(60) + '\n');

  isRunning = false;
  return { duration_seconds: duration, status: finalStatus, ...totals, stores: storeResults };
}

// ─── Single-product scan (for debug routes) ───────────────────────────────────
async function scanSingleProduct(storeSlug, urlOrId) {
  if (PROXY_KILL_SWITCH) {
    logger.warn(`[ScanJob] PROXY_KILL_SWITCH active — skipping scan job for ${storeSlug}`);
    return { skipped: true, reason: 'proxy_kill_switch' };
  }

  const scrapers = {
    'walmart':        () => getWalmartScraper().scrapeWalmartProduct(urlOrId),
    'best-buy':       () => getBestBuyScraper().scrapeBestBuyProduct(urlOrId),
    'home-depot':     () => getHomeDepotScraper().scrapeHomeDepotProduct(urlOrId),
    'target':         () => getTargetScraper().scrapeTargetProduct(urlOrId),
    'lowes':          () => getLowesScraper().scrapeLowesProduct(urlOrId),
    'macys':          () => getMacysScraper().scrapeMacysProduct(urlOrId),
    'tj-maxx':        () => getTjmaxxScraper().scrapeTjmaxxProduct(urlOrId),
    'marshalls':      () => getMarshallsScraper().scrapeMarshallsProduct(urlOrId),
    'kohls':          () => getKohlsScraper().scrapeKohlsProduct(urlOrId),
    'costco':         () => getCostcoScraper().scrapeCostcoProduct(urlOrId),
    'gamestop':       () => getGameStopScraper().scrapeGameStopProduct(urlOrId),
    'office-depot':   () => getOfficeDepotScraper().scrapeOfficeDepotProduct(urlOrId),
    'staples':        () => getStaplesScraper().scrapeStaplesProduct(urlOrId),
    'nordstrom-rack': () => getNordstromRackScraper().scrapeNordstromRackProduct(urlOrId),
    'harbor-freight': () => getHarborFreightScraper().scrapeHarborFreightProduct(urlOrId),
    'wayfair':        () => getWayfairScraper().scrapeWayfairProduct(urlOrId),
  };

  const fn = scrapers[storeSlug];
  if (!fn) throw new Error(`No scraper for store: ${storeSlug}`);

  const t0 = Date.now();
  const result = await fn();

  // Guardar scan individual como LIVE si viene con precio
  if (result?.currentPrice) {
    const storeRes = await query('SELECT id FROM stores WHERE slug = $1 LIMIT 1', [storeSlug]);
    const storeId = storeRes.rows[0]?.id;
    if (!storeId) throw new Error(`Store not found: ${storeSlug}`);

    let dbProduct = null;

    // 1) Intentar encontrar producto existente por URL
    if (result.productUrl) {
      const existing = await query(
        'SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.product_url = $1 LIMIT 1',
        [result.productUrl]
      );
      dbProduct = existing.rows[0] || null;
    }

    // 2) Si no existe, crear producto nuevo live
    if (!dbProduct) {
      const inferredSlug = inferCategorySlug(storeSlug, result.name || '');
      let categoryId = null;
      let catSlug = null;
      if (inferredSlug) {
        const catInferred = await query('SELECT id FROM categories WHERE slug=$1 LIMIT 1', [inferredSlug]);
        categoryId = catInferred.rows[0]?.id || null;
        catSlug = categoryId ? inferredSlug : null;
      }
      if (!categoryId) {
        const cat = await query('SELECT id, slug FROM categories ORDER BY name LIMIT 1');
        categoryId = cat.rows[0]?.id || null;
        catSlug = cat.rows[0]?.slug || null;
      }

      const inserted = await query(
        `INSERT INTO products (name, brand, sku, upc, store_id, category_id, image_url, product_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (sku, store_id) DO UPDATE SET
           name = EXCLUDED.name,
           brand = COALESCE(EXCLUDED.brand, products.brand),
           image_url = COALESCE(EXCLUDED.image_url, products.image_url),
           product_url = COALESCE(EXCLUDED.product_url, products.product_url),
           updated_at = NOW()
         RETURNING *`,
        [
          result.name || `Live product ${Date.now()}`,
          result.brand || null,
          result.sku || result.productUrl || `live-${storeSlug}-${Date.now()}`,
          result.upc || null,
          storeId,
          categoryId,
          result.imageUrl || null,
          result.productUrl || urlOrId
        ]
      );

      dbProduct = { ...inserted.rows[0], cat_slug: catSlug };
    }

    await saveProductData(dbProduct, result, storeSlug);
    result.saved = true;
    result.data_source = 'live';
  }

  return { ...result, elapsed_ms: Date.now() - t0 };
}

// ─── Cron schedule ────────────────────────────────────────────────────────────
function startScanJob() {
  const interval = parseInt(process.env.SCAN_INTERVAL_MINUTES) || 30;

  // Main scan — all active stores
  cron.schedule(`*/${interval} * * * *`, () => {
    logger.info(`[Cron] Full scan triggered (every ${interval}m)`);
    runScan().catch(err => logger.error('[Cron] Full scan error: ' + err.message));
  });

  // Walmart peak hours — prices change most frequently at these times
  if (ACTIVE_STORES.includes('walmart')) {
    cron.schedule('0 6,9,12,15,18,21 * * *', () => {
      logger.info('[Cron] Walmart peak-hour scan');
      runScan('walmart').catch(err => logger.error('[Cron] Walmart peak scan error: ' + err.message));
    });
  }

  // Best Buy — deals change morning + evening
  if (ACTIVE_STORES.includes('best-buy')) {
    cron.schedule('30 8,20 * * *', () => {
      logger.info('[Cron] Best Buy daily scan');
      runScan('best-buy').catch(err => logger.error('[Cron] Best Buy scan error: ' + err.message));
    });
  }

  // Home Depot — weekday business hours
  if (ACTIVE_STORES.includes('home-depot')) {
    cron.schedule('30 7,10,13,16,19 * * 1-5', () => {
      logger.info('[Cron] Home Depot business-hours scan');
      runScan('home-depot').catch(err => logger.error('[Cron] Home Depot scan error: ' + err.message));
    });
  }

  logger.info(`[ScanJob] Cron started | interval: ${interval}m | active stores: ${ACTIVE_STORES.join(', ')}`);

  // Initial scan 30s after startup — gives server time to fully start
  setTimeout(() => {
    logger.info('[ScanJob] Initial scan starting…');
    runScan().catch(err => logger.error('[Cron] Initial scan error: ' + err.message));
  }, 30000);
}

// Graceful shutdown
process.on('SIGINT',  async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

module.exports = { startScanJob, runScan, scanSingleProduct, _circuit, checkProxyConnectivity };

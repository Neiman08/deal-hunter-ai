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
const { closeBrowser }   = require('../services/browserEngine');
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
};

// All available scrapers — enable via ACTIVE_STORES env or run all by default
const ALL_STORES = 'walmart,best-buy,home-depot,target,lowes,macys,tj-maxx,marshalls,kohls,costco,gamestop,office-depot,staples,nordstrom-rack';
const ACTIVE_STORES = (process.env.ACTIVE_STORES || ALL_STORES).split(',').map(s => s.trim());

let isRunning = false;

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

  // Create a single scan_log row covering this run
  let logId = null;
  try {
    const logRes = await query(`
      INSERT INTO scan_logs (store_name, status, started_at)
      VALUES ($1, 'running', NOW())
      RETURNING id
    `, [stores.join('+')]);
    logId = logRes.rows[0]?.id;
  } catch (err) {
    logger.warn(`[ScanJob] Could not create scan_log: ${err.message}`);
  }

  const totals = { scanned: 0, deals: 0, errors: 0 };
  const storeResults = {};

  for (const store of stores) {
    const scraper = STORE_SCRAPERS[store];
    if (!scraper) {
      logger.warn(`[ScanJob] No scraper registered for "${store}"`);
      continue;
    }

    const storeStart = Date.now();
    logger.info(`\n[ScanJob] ── Starting ${store} ──`);

    try {
      const result = await scraper();
      totals.scanned += result.products_scanned || 0;
      totals.deals   += result.deals_found      || 0;
      totals.errors  += result.errors           || 0;
      storeResults[store] = {
        ...result,
        duration_ms: Date.now() - storeStart,
        status: 'success',
      };
      logger.info(`[ScanJob] ${store} done in ${((Date.now() - storeStart) / 1000).toFixed(1)}s`);
    } catch (err) {
      logger.error(`[ScanJob] ${store} FAILED: ${err.message}`);
      totals.errors++;
      storeResults[store] = { status: 'error', error: err.message, duration_ms: Date.now() - storeStart };
    }
  }

  // Deactivate stale deals (not seen in last 2 hours)
  try {
    const deactivated = await query(`
      UPDATE deals SET is_active = false
      WHERE last_seen_at < NOW() - INTERVAL '24 hours'
        AND is_active = true
    `);
    if (deactivated.rowCount > 0) {
      logger.info(`[ScanJob] Deactivated ${deactivated.rowCount} stale deals`);
    }
  } catch (err) {
    logger.warn(`[ScanJob] Could not deactivate stale deals: ${err.message}`);
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

  // Update scan_log
  if (logId) {
    try {
      await query(`
        UPDATE scan_logs SET
          status           = $1,
          products_scanned = $2,
          deals_found      = $3,
          errors_count     = $4,
          duration_seconds = $5,
          completed_at     = NOW()
        WHERE id = $6
      `, [
        totals.errors > 0 && totals.scanned === 0 ? 'error' : 'success',
        totals.scanned, totals.deals, totals.errors, duration, logId,
      ]);
    } catch (err) {
      logger.warn(`[ScanJob] Could not update scan_log: ${err.message}`);
    }
  }

  logger.info('\n' + '█'.repeat(60));
  logger.info(`[ScanJob] COMPLETE in ${duration}s`);
  logger.info(`  Scanned: ${totals.scanned} | Deals: ${totals.deals} | Errors: ${totals.errors}`);
  Object.entries(storeResults).forEach(([store, r]) => {
    const icon = r.status === 'success' ? '✅' : '❌';
    logger.info(`  ${icon} ${store}: scanned=${r.products_scanned||0} deals=${r.deals_found||0} (${(r.duration_ms/1000).toFixed(1)}s)`);
  });
  logger.info('█'.repeat(60) + '\n');

  isRunning = false;
  return { duration_seconds: duration, ...totals, stores: storeResults };
}

// ─── Single-product scan (for debug routes) ───────────────────────────────────
async function scanSingleProduct(storeSlug, urlOrId) {
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
      const cat = await query('SELECT id, slug FROM categories ORDER BY name LIMIT 1');
      const categoryId = cat.rows[0]?.id || null;

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

      dbProduct = { ...inserted.rows[0], cat_slug: cat.rows[0]?.slug || null };
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

module.exports = { startScanJob, runScan, scanSingleProduct };

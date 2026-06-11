const express = require('express');
const https = require('https');
const http = require('http');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Heavy endpoints (Playwright / scraping) are ONLY allowed on the worker service.
// On the web service they return 503 to prevent OOM crashes.
const IS_WORKER = process.env.IS_WORKER === 'true'
  || (process.env.RENDER_SERVICE_NAME || '').toLowerCase().includes('worker')
  || process.env.NODE_ENV !== 'production';

function workerOnly(req, res, next) {
  if (IS_WORKER) return next();
  return res.status(503).json({
    ok: false,
    error: 'This endpoint runs heavy scraping (Playwright/scan). It is disabled on the web service to prevent OOM. Use the deal-hunter-worker service or run locally.',
    hint: 'Set IS_WORKER=true on the worker Render service.',
  });
}

// GET /admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [users, deals, scans, stores] = await Promise.all([
      query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE plan = 'pro') as pro,
        COUNT(*) FILTER (WHERE plan = 'elite') as elite,
        COUNT(*) FILTER (WHERE plan = 'free') as free,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week
        FROM users WHERE is_active = true`),
      query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active) as active,
        COUNT(*) FILTER (WHERE NOT is_active) as expired,
        COUNT(*) FILTER (WHERE is_error_price AND is_active) as error_prices,
        AVG(opportunity_score) FILTER (WHERE is_active) as avg_score
        FROM deals`),
      query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'error') as failed,
        MAX(started_at) as last_scan
        FROM scan_logs`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active FROM stores`),
    ]);

    res.json({
      users: users.rows[0],
      deals: deals.rows[0],
      scans: scans.rows[0],
      stores: stores.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/scan-logs
router.get('/scan-logs', async (req, res) => {
  try {
    const r = await query(`
      SELECT sl.*, s.name as store_name, s.slug as store_slug
      FROM scan_logs sl LEFT JOIN stores s ON sl.store_id = s.id
      ORDER BY sl.started_at DESC LIMIT 50
    `);
    res.json({ logs: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/users
router.get('/users', async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    let cond = '', params = [];
    if (search) {
      cond = `WHERE name ILIKE $1 OR email ILIKE $1`;
      params.push(`%${search}%`);
    }
    const r = await query(`
      SELECT id, email, name, plan, zip_code, is_admin, is_active,
        stripe_customer_id, created_at, updated_at
      FROM users ${cond}
      ORDER BY created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `, params);
    res.json({ users: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/users/:id/plan
router.put('/users/:id/plan', async (req, res) => {
  const { plan } = req.body;
  if (!['free', 'pro', 'elite'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  try {
    await query(`UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`, [plan, req.params.id]);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/scan — trigger manual scan for one or all active stores
router.post('/scan', workerOnly, async (req, res) => {
  const { store } = req.body;
  const { runScan } = require('../jobs/scanJob');
  res.json({ message: `Scan triggered for ${store || 'all active stores'}`, queued: true });

  setImmediate(async () => {
    try {
      await runScan(store || null);
    } catch (err) {
      console.error('[Admin/scan] error:', err.message);
    }
  });
});

// POST /admin/discovery — run all discovery engines to find new products
router.post('/discovery', workerOnly, async (req, res) => {
  const { store } = req.body;

  // Each module exports a named function OR a generic runDiscovery alias
  function loadDiscovery(file) {
    const mod = require(`../services/discovery/${file}`);
    return mod.runDiscovery || Object.values(mod).find(v => typeof v === 'function');
  }

  const DISCOVERY_MODULES = {
    'walmart':        () => loadDiscovery('walmartDiscovery')(),
    'best-buy':       () => loadDiscovery('bestBuyDiscovery')(),
    'home-depot':     () => loadDiscovery('homeDepotDiscovery')(),
    'target':         () => loadDiscovery('targetDiscovery')(),
    'lowes':          () => loadDiscovery('lowesDiscovery')(),
    'macys':          () => loadDiscovery('macysDiscovery')(),
    'tj-maxx':        () => loadDiscovery('tjmaxxDiscovery')(),
    'marshalls':      () => loadDiscovery('marshallsDiscovery')(),
    'kohls':          () => loadDiscovery('kohlsDiscovery')(),
    'costco':         () => loadDiscovery('costcoDiscovery')(),
    'gamestop':       () => loadDiscovery('gamestopDiscovery')(),
    'office-depot':   () => loadDiscovery('officeDepotDiscovery')(),
    'staples':        () => loadDiscovery('staplesDiscovery')(),
    'nordstrom-rack': () => loadDiscovery('nordstromRackDiscovery')(),
  };

  const { acquireLock, releaseLock } = require('../services/discoveryLock');
  const lockLabel = store || 'all';
  if (!acquireLock(lockLabel)) {
    const { getStatus } = require('../services/discoveryLock');
    return res.status(409).json({ error: 'Discovery already running', status: getStatus() });
  }

  const targets = store ? [store] : Object.keys(DISCOVERY_MODULES);
  res.json({ message: `Discovery triggered for: ${targets.join(', ')}`, stores: targets, queued: true });

  setImmediate(async () => {
    const { isStopRequested } = require('../services/discoveryLock');
    const results = {};
    try {
      for (const slug of targets) {
        if (isStopRequested()) { results[slug] = { skipped: 'stop_requested' }; continue; }
        const fn = DISCOVERY_MODULES[slug];
        if (!fn) { results[slug] = { error: 'No discovery module' }; continue; }
        try {
          results[slug] = await fn();
          console.log(`[Discovery:${slug}] done:`, JSON.stringify(results[slug]).slice(0, 200));
        } catch (err) {
          console.error(`[Discovery:${slug}] error:`, err.message);
          results[slug] = { error: err.message };
        }
      }
    } finally {
      releaseLock();
    }
    console.log('[Admin/discovery] All done:', JSON.stringify(results).slice(0, 500));
  });
});

// DELETE /admin/deals/expired
router.delete('/deals/expired', async (req, res) => {
  try {
    const r = await query(`
      UPDATE deals SET is_active = false
      WHERE is_active = true AND (
        expires_at < NOW() OR last_seen_at < NOW() - INTERVAL '48 hours'
      )
      RETURNING id
    `);
    res.json({ message: `Deactivated ${r.rowCount} expired deals`, count: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/stores/:slug/toggle
router.put('/stores/:slug/toggle', async (req, res) => {
  try {
    const r = await query(`
      UPDATE stores SET is_active = NOT is_active WHERE slug = $1 RETURNING is_active, name
    `, [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ error: 'Store not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Submitted Deals Admin ─────────────────────────────────────────────────────

// GET /admin/submitted-deals
router.get('/submitted-deals', async (req, res) => {
  try {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;
    const r = await query(
      `SELECT sd.*,
              s.name AS store_name, s.slug AS store_slug, s.color AS store_color,
              u.name AS submitter_name, u.email AS submitter_email,
              cp.display_name, cp.level, cp.points AS collab_points,
              cp.approved_deals_count, cp.rejected_deals_count, cp.reputation_score
       FROM submitted_deals sd
       LEFT JOIN stores s ON sd.store_id = s.id
       LEFT JOIN users u ON sd.user_id = u.id
       LEFT JOIN collaborator_profiles cp ON sd.collaborator_id = cp.id
       WHERE ($1::text = 'all' OR sd.status = $1)
       ORDER BY sd.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, parseInt(limit), parseInt(offset)]
    );
    const counts = await query(
      `SELECT status, COUNT(*) FROM submitted_deals GROUP BY status`
    );
    const countMap = {};
    counts.rows.forEach(row => { countMap[row.status] = parseInt(row.count); });
    res.json({ submissions: r.rows, counts: countMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/submitted-deals/:id/approve
router.post('/submitted-deals/:id/approve', async (req, res) => {
  try {
    const { admin_notes } = req.body;
    const submRes = await query(
      'SELECT * FROM submitted_deals WHERE id = $1',
      [req.params.id]
    );
    if (!submRes.rows[0]) return res.status(404).json({ error: 'Submission not found' });
    const sub = submRes.rows[0];

    if (sub.status === 'approved') return res.status(409).json({ error: 'Already approved' });

    // Get store
    const storeRes = await query('SELECT * FROM stores WHERE id = $1', [sub.store_id]);
    if (!storeRes.rows[0]) return res.status(400).json({ error: 'Store not found' });
    const store = storeRes.rows[0];

    // Get or create category
    let catId = null;
    const catRes = await query("SELECT id FROM categories WHERE slug = 'other' LIMIT 1");
    if (catRes.rows[0]) catId = catRes.rows[0].id;

    // Upsert product
    let productId;
    const existingProduct = await query(
      `SELECT id FROM products WHERE store_id = $1 AND (
         ($2::text IS NOT NULL AND upc = $2) OR
         ($3::text IS NOT NULL AND sku = $3) OR
         name ILIKE $4
       ) LIMIT 1`,
      [store.id, sub.upc || null, sub.sku || null, sub.product_name || '']
    );

    if (existingProduct.rows[0]) {
      productId = existingProduct.rows[0].id;
      await query(
        `UPDATE products SET
           name = COALESCE($1, name), brand = COALESCE($2, brand),
           image_url = COALESCE($3, image_url), updated_at = NOW()
         WHERE id = $4`,
        [sub.product_name, sub.brand, sub.image_url, productId]
      );
    } else {
      const newProduct = await query(
        `INSERT INTO products (store_id, category_id, name, brand, sku, upc, image_url, product_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          store.id, catId, sub.product_name || 'Submitted Deal',
          sub.brand, sub.sku, sub.upc, sub.image_url, sub.product_url,
        ]
      );
      productId = newProduct.rows[0].id;
    }

    // Record price
    await query(
      `INSERT INTO prices (product_id, regular_price, current_price, source)
       VALUES ($1, $2, $3, 'collaborator')`,
      [productId, sub.regular_price || sub.found_price, sub.found_price]
    );

    // Calculate discount and profit
    const discountPct = sub.regular_price
      ? Math.round(((sub.regular_price - sub.found_price) / sub.regular_price) * 100)
      : 0;
    const savings = sub.regular_price ? sub.regular_price - sub.found_price : 0;

    // Upsert deal
    let dealId;
    const existingDeal = await query(
      'SELECT id FROM deals WHERE product_id = $1 AND store_id = $2 LIMIT 1',
      [productId, store.id]
    );
    if (existingDeal.rows[0]) {
      dealId = existingDeal.rows[0].id;
      await query(
        `UPDATE deals SET
           deal_price = $1, regular_price = $2, discount_percent = $3,
           is_active = true, data_source = 'live', last_seen_at = NOW()
         WHERE id = $4`,
        [sub.found_price, sub.regular_price || sub.found_price, discountPct, dealId]
      );
    } else {
      const newDeal = await query(
        `INSERT INTO deals
           (product_id, store_id, deal_price, regular_price, discount_percent,
            is_active, data_source, opportunity_score, opportunity_label)
         VALUES ($1, $2, $3, $4, $5, true, 'live', $6, $7) RETURNING id`,
        [
          productId, store.id, sub.found_price,
          sub.regular_price || sub.found_price, discountPct,
          Math.min(100, discountPct + 10),
          discountPct >= 70 ? '🔥 Excellent' : discountPct >= 50 ? '✅ Good Deal' : '📦 Average',
        ]
      );
      dealId = newDeal.rows[0].id;
    }

    // Mark submission approved
    await query(
      `UPDATE submitted_deals SET
         status = 'approved', approved_by = $1, approved_at = NOW(),
         admin_notes = $2, created_deal_id = $3, updated_at = NOW()
       WHERE id = $4`,
      [req.user.id, admin_notes || null, dealId, sub.id]
    );

    // Update feed post status — make it active so it shows in the public feed
    await query(
      `UPDATE deal_posts SET status = 'active', deal_id = $1, updated_at = NOW()
       WHERE submitted_deal_id = $2`,
      [dealId, sub.id]
    );

    // Award points to collaborator
    if (sub.collaborator_id) {
      const { getLevel } = require('./collaborators');
      const pointsToAdd = [];
      pointsToAdd.push({ action: 'approved', pts: 10, desc: 'Deal approved by admin' });
      if (sub.image_url || sub.shelf_image_url || sub.price_tag_image_url) {
        pointsToAdd.push({ action: 'photo_approved', pts: 5, desc: 'Photo evidence rewarded' });
      }
      if (sub.receipt_image_url) {
        pointsToAdd.push({ action: 'receipt_approved', pts: 10, desc: 'Receipt evidence rewarded' });
      }
      if (discountPct >= 50) {
        pointsToAdd.push({ action: 'high_discount', pts: 10, desc: '50%+ discount deal' });
      }
      if (sub.estimated_profit >= 30) {
        pointsToAdd.push({ action: 'high_profit', pts: 10, desc: '$30+ profit potential' });
      }

      let totalPoints = 0;
      for (const p of pointsToAdd) {
        await query(
          `INSERT INTO collaborator_points_log (collaborator_id, submitted_deal_id, action, points, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [sub.collaborator_id, sub.id, p.action, p.pts, p.desc]
        );
        totalPoints += p.pts;
      }

      const updRes = await query(
        `UPDATE collaborator_profiles SET
           points = points + $1,
           approved_deals_count = approved_deals_count + 1,
           pending_deals_count = GREATEST(0, pending_deals_count - 1),
           updated_at = NOW()
         WHERE id = $2 RETURNING points`,
        [totalPoints, sub.collaborator_id]
      );
      const newPoints = updRes.rows[0]?.points || 0;
      const newLevel = getLevel(newPoints);
      await query(
        `UPDATE collaborator_profiles SET level = $1 WHERE id = $2`,
        [newLevel, sub.collaborator_id]
      );

      // Update team points if member of a team
      const cpTeam = await query('SELECT team_id FROM collaborator_profiles WHERE id = $1', [sub.collaborator_id]);
      if (cpTeam.rows[0]?.team_id) {
        await query(
          `UPDATE teams SET points = points + $1, approved_deals_count = approved_deals_count + 1
           WHERE id = $2`,
          [totalPoints, cpTeam.rows[0].team_id]
        );
      }
    }

    res.json({ message: 'Deal approved and created', deal_id: dealId, product_id: productId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/submitted-deals/:id/reject
router.post('/submitted-deals/:id/reject', async (req, res) => {
  try {
    const { rejection_reason, admin_notes } = req.body;
    if (!rejection_reason?.trim()) return res.status(400).json({ error: 'rejection_reason required' });

    const submRes = await query(
      'SELECT * FROM submitted_deals WHERE id = $1',
      [req.params.id]
    );
    if (!submRes.rows[0]) return res.status(404).json({ error: 'Submission not found' });
    const sub = submRes.rows[0];

    await query(
      `UPDATE submitted_deals SET
         status = 'rejected', rejection_reason = $1, admin_notes = $2,
         approved_by = $3, approved_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [rejection_reason.trim(), admin_notes || null, req.user.id, sub.id]
    );

    // Update feed post
    await query(
      `UPDATE deal_posts SET status = 'rejected', updated_at = NOW()
       WHERE submitted_deal_id = $1`,
      [sub.id]
    );

    // Update collaborator counts (no points)
    if (sub.collaborator_id) {
      await query(
        `UPDATE collaborator_profiles SET
           rejected_deals_count = rejected_deals_count + 1,
           pending_deals_count = GREATEST(0, pending_deals_count - 1),
           updated_at = NOW()
         WHERE id = $1`,
        [sub.collaborator_id]
      );

      await query(
        `INSERT INTO collaborator_points_log (collaborator_id, submitted_deal_id, action, points, description)
         VALUES ($1, $2, 'rejected', 0, $3)`,
        [sub.collaborator_id, sub.id, `Rejected: ${rejection_reason}`]
      );
    }

    res.json({ message: 'Submission rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/db-cleanup — remove seed/demo data and normalize labels
router.post('/db-cleanup', async (req, res) => {
  try {
    // Seed deals all have the same detected_at second — delete by exact second window
    const deleted = await query(
      `DELETE FROM deals
       WHERE detected_at >= '2026-06-07 16:32:00'::timestamptz
         AND detected_at <  '2026-06-07 16:32:03'::timestamptz
       RETURNING id`
    );

    // Normalize ALL active deal labels to English based on score
    const updated = await query(`
      UPDATE deals SET
        opportunity_label = CASE
          WHEN opportunity_score >= 91 THEN '🔥 Excellent'
          WHEN opportunity_score >= 81 THEN '💎 Excellent Deal'
          WHEN opportunity_score >= 71 THEN '✅ Good Deal'
          WHEN opportunity_score >= 41 THEN '📦 Average'
          ELSE '⬇️ Skip'
        END
      WHERE is_active = true
      RETURNING id
    `);

    res.json({
      message: 'Cleanup complete',
      deals_deleted: deleted.rowCount,
      labels_normalized: updated.rowCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/db-counts — read-only table counts and recent rows (no writes)
router.get('/db-counts', async (req, res) => {
  try {
    const [products, prices, deals, stores, scanLogs, latestProducts, latestPrices, latestDeals, failureSummary] = await Promise.all([
      query('SELECT COUNT(*) AS cnt FROM products'),
      query('SELECT COUNT(*) AS cnt FROM prices'),
      query('SELECT COUNT(*) AS cnt FROM deals'),
      query('SELECT COUNT(*) AS cnt FROM stores'),
      query('SELECT COUNT(*) AS cnt FROM scan_logs'),
      query(`SELECT p.id, p.name, p.sku, s.slug as store, p.created_at
             FROM products p JOIN stores s ON p.store_id=s.id
             ORDER BY p.created_at DESC LIMIT 5`),
      query(`SELECT pr.id, pr.product_id, pr.current_price, pr.regular_price, pr.discount_percent, pr.recorded_at
             FROM prices pr ORDER BY pr.recorded_at DESC LIMIT 5`),
      query(`SELECT d.id, p.name as product_name, d.deal_price, d.discount_percent, d.opportunity_score, d.is_active, d.detected_at
             FROM deals d JOIN products p ON d.product_id = p.id ORDER BY d.detected_at DESC LIMIT 5`),
      query(`SELECT store_name, status, products_scanned, deals_found, errors_count, duration_seconds, started_at, completed_at
             FROM scan_logs ORDER BY started_at DESC LIMIT 5`),
    ]);
    res.json({
      products: parseInt(products.rows[0].cnt),
      prices: parseInt(prices.rows[0].cnt),
      deals: parseInt(deals.rows[0].cnt),
      stores: parseInt(stores.rows[0].cnt),
      scan_logs: parseInt(scanLogs.rows[0].cnt),
      latest_products: latestProducts.rows,
      latest_prices: latestPrices.rows,
      latest_deals: latestDeals.rows,
      latest_scan_logs: failureSummary.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/proxy-status — check proxy config and per-store failure summary (no credentials exposed)
router.get('/proxy-status', async (req, res) => {
  try {
    const proxyManager = require('../services/proxyManager');
    const summary = proxyManager.getFailureSummary ? proxyManager.getFailureSummary() : {};
    res.json({
      proxy_enabled: process.env.PROXY_ENABLED === 'true',
      proxy_provider: process.env.PROXY_PROVIDER || 'none',
      proxy_host: process.env.PROXY_HOST ? process.env.PROXY_HOST.split('.')[0] + '...' : null,
      failure_summary: summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/clear-failures — reset in-memory proxy failure log so skipped stores retry
router.post('/clear-failures', async (req, res) => {
  try {
    const proxyManager = require('../services/proxyManager');
    const stores = ['walmart','best-buy','home-depot','target','lowes','macys','tj-maxx','marshalls','kohls','costco','gamestop','office-depot','staples','nordstrom-rack'];
    stores.forEach(s => proxyManager.clearFailures(s));
    res.json({ cleared: stores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/discovery-status — current discovery lock state
router.get('/discovery-status', (req, res) => {
  const { getStatus } = require('../services/discoveryLock');
  res.json(getStatus());
});

// POST /admin/stop-discovery — request graceful stop of running discovery
router.post('/stop-discovery', (req, res) => {
  const { getStatus, requestStop } = require('../services/discoveryLock');
  const before = getStatus();
  if (!before.running) return res.json({ ok: false, message: 'No discovery running' });
  requestStop();
  res.json({ ok: true, message: `Stop requested for ${before.store}`, status: getStatus() });
});

// GET /admin/test-discovery/:store — run ONE store's discovery synchronously, return full result
// Protected by global lock — rejects if another discovery is already running.
router.get('/test-discovery/:store', workerOnly, async (req, res) => {
  const { store } = req.params;
  const { acquireLock, releaseLock } = require('../services/discoveryLock');
  const start = Date.now();

  if (!acquireLock(store)) {
    const { getStatus } = require('../services/discoveryLock');
    return res.status(409).json({ ok: false, error: 'Discovery already running', status: getStatus() });
  }

  try {
    function loadDiscovery(file) {
      const mod = require(`../services/discovery/${file}`);
      return mod.runDiscovery || Object.values(mod).find(v => typeof v === 'function');
    }
    const FILE_MAP = {
      'walmart': 'walmartDiscovery', 'best-buy': 'bestBuyDiscovery',
      'home-depot': 'homeDepotDiscovery', 'target': 'targetDiscovery',
      'lowes': 'lowesDiscovery', 'macys': 'macysDiscovery',
      'tj-maxx': 'tjmaxxDiscovery', 'marshalls': 'marshallsDiscovery',
      'kohls': 'kohlsDiscovery', 'costco': 'costcoDiscovery',
      'gamestop': 'gamestopDiscovery', 'office-depot': 'officeDepotDiscovery',
      'staples': 'staplesDiscovery', 'nordstrom-rack': 'nordstromRackDiscovery',
    };
    const file = FILE_MAP[store];
    if (!file) return res.status(400).json({ error: `Unknown store: ${store}` });
    const fn = loadDiscovery(file);
    if (!fn) return res.status(500).json({ error: `No discovery function for ${store}` });
    const result = await fn({ maxPerPage: 10, maxTotal: 10 });
    res.json({ ok: true, store, result, elapsed_ms: Date.now() - start });
  } catch (err) {
    res.status(500).json({ ok: false, store, error: err.message, elapsed_ms: Date.now() - start });
  } finally {
    releaseLock();
  }
});

// GET /admin/test-browser — verify Playwright Chromium is available on this server
router.get('/test-browser', workerOnly, async (req, res) => {
  const start = Date.now();
  let browser = null;
  try {
    const path = require('path');
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '../../../pw-browsers');
    }
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://example.com', { timeout: 15000 });
    const title = await page.title();
    await browser.close();
    res.json({ ok: true, title, elapsed_ms: Date.now() - start, message: 'Chromium is working' });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.json({ ok: false, error: err.message, elapsed_ms: Date.now() - start });
  }
});

// GET /admin/test-links?url=...&proxy=1 — dump raw hrefs from a page
// Add ?proxy=1 to route through residential proxy (needed for Cloudflare-protected sites)
router.get('/test-links', workerOnly, async (req, res) => {
  const { url, wait = 'networkidle', scroll = '1', proxy = '0' } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });
  const start = Date.now();
  let ctx = null;
  try {
    const { newContext, newBestBuyContext } = require('../services/browserEngine');
    ctx = proxy === '1' && process.env.PROXY_ENABLED === 'true'
      ? await newContext()
      : await newBestBuyContext();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: wait, timeout: 45000 });
    if (scroll === '1') {
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(600);
      }
    }
    const title = await page.title();
    const hrefs = await page.evaluate(() => {
      const s = new Set();
      document.querySelectorAll('a[href]').forEach(a => { const h = a.getAttribute('href'); if (h) s.add(h); });
      return [...s];
    });
    const withProducts    = hrefs.filter(h => h.includes('/product'));
    const withCollections = hrefs.filter(h => h.includes('/collection'));
    const cloudflareBlock = title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention required');
    const captchaBlock    = title.toLowerCase().includes('captcha');
    res.json({
      ok: true, url, title,
      cloudflare_blocked: cloudflareBlock,
      captcha: captchaBlock,
      proxy_used: proxy === '1',
      total_hrefs: hrefs.length,
      product_hrefs_count: withProducts.length,
      collections_hrefs_count: withCollections.length,
      sample_all: hrefs.slice(0, 100),
      product_hrefs: withProducts.slice(0, 50),
      collections_hrefs: withCollections.slice(0, 20),
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, elapsed_ms: Date.now() - start });
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
});

// GET /admin/test-scraper/:store — run a single store scraper and return raw result
router.get('/test-scraper/:store', workerOnly, async (req, res) => {
  const { store } = req.params;
  const start = Date.now();
  try {
    const { runScan } = require('../jobs/scanJob');
    const result = await runScan(store);
    res.json({ ok: true, store, result, elapsed_ms: Date.now() - start });
  } catch (err) {
    res.json({ ok: false, store, error: err.message, elapsed_ms: Date.now() - start });
  }
});

// ─── Worker Monitor endpoints ─────────────────────────────────────────────────

// GET /admin/worker-status — background worker health + last cycle data
router.get('/worker-status', async (req, res) => {
  try {
    const monitor = require('../services/workerMonitor');
    const [status, recentRuns] = await Promise.all([
      monitor.getStatus(),
      monitor.getRecentRuns(5),
    ]);
    res.json({ ok: true, ...status, recent_runs: recentRuns });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/store-report — per-store product/deal breakdown
router.get('/store-report', async (req, res) => {
  try {
    const monitor = require('../services/workerMonitor');
    const stores  = await monitor.getStoreSummary();
    res.json({ ok: true, stores, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/test-proxy — verify proxy connectivity + show env vars
router.get('/test-proxy', async (req, res) => {
  const PROXY_ENABLED   = process.env.PROXY_ENABLED;
  const ISP_PROXY_ENABLED = process.env.ISP_PROXY_ENABLED;
  const PROXY_HOST      = process.env.PROXY_HOST;
  const PROXY_PORT      = process.env.PROXY_PORT;
  const PROXY_USER      = process.env.PROXY_USER || '';
  const PROXY_PASS      = process.env.PROXY_PASS || '';
  const ISP_PROXY_HOST  = process.env.ISP_PROXY_HOST;
  const ISP_PROXY_PORT  = process.env.ISP_PROXY_PORT;
  const ISP_PROXY_USER  = process.env.ISP_PROXY_USER || '';
  const ISP_PROXY_PASS  = process.env.ISP_PROXY_PASS || '';

  const envSnapshot = {
    PROXY_ENABLED,
    ISP_PROXY_ENABLED: ISP_PROXY_ENABLED || '(not set)',
    PROXY_HOST:        PROXY_HOST        || '(not set)',
    PROXY_PORT:        PROXY_PORT        || '(not set)',
    PROXY_USER:        PROXY_USER ? PROXY_USER.slice(0, 35) + '...' : '(not set)',
    PROXY_PASS:        PROXY_PASS ? '***set***' : '(not set)',
    ISP_PROXY_HOST:    ISP_PROXY_HOST    || '(not set)',
    ISP_PROXY_PORT:    ISP_PROXY_PORT    || '(not set)',
    ISP_PROXY_USER:    ISP_PROXY_USER ? ISP_PROXY_USER.slice(0, 35) + '...' : '(not set)',
    ISP_PROXY_PASS:    ISP_PROXY_PASS ? '***set***' : '(not set)',
  };

  const results = {};

  // Test 1: direct (no proxy)
  const directTest = await new Promise(resolve => {
    const req2 = https.get('https://api.ipify.org?format=json', { timeout: 8000 }, res2 => {
      const chunks = [];
      res2.on('data', c => chunks.push(c));
      res2.on('end', () => {
        try { resolve({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req2.on('error', e => resolve({ ok: false, error: e.message }));
    req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
  results.direct = directTest;

  // Test 2: via PROXY_* vars (HttpsProxyAgent)
  if (PROXY_ENABLED === 'true' && PROXY_HOST && PROXY_USER && PROXY_PASS) {
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
      const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT || 22225}`;
      const agent = new Ctor(proxyUrl, { rejectUnauthorized: false });

      const proxyTest = await new Promise(resolve => {
        const req2 = https.get('https://api.ipify.org?format=json', { agent, timeout: 15000, rejectUnauthorized: false }, res2 => {
          const chunks = [];
          res2.on('data', c => chunks.push(c));
          res2.on('end', () => {
            try { resolve({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
            catch (e) { resolve({ ok: false, error: e.message }); }
          });
        });
        req2.on('error', e => resolve({ ok: false, error: e.message }));
        req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'timeout' }); });
      });
      results.proxy_main = { url: `${PROXY_HOST}:${PROXY_PORT}`, ...proxyTest };
    } catch (e) {
      results.proxy_main = { ok: false, error: e.message };
    }
  } else {
    results.proxy_main = { ok: false, error: 'PROXY_ENABLED != true or credentials missing' };
  }

  // Test 3: via ISP_PROXY_* vars (if set)
  if (ISP_PROXY_HOST && ISP_PROXY_USER && ISP_PROXY_PASS) {
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
      const ispUrl = `http://${ISP_PROXY_USER}:${ISP_PROXY_PASS}@${ISP_PROXY_HOST}:${ISP_PROXY_PORT || 33335}`;
      const agent = new Ctor(ispUrl, { rejectUnauthorized: false });

      const ispTest = await new Promise(resolve => {
        const req2 = https.get('https://api.ipify.org?format=json', { agent, timeout: 15000, rejectUnauthorized: false }, res2 => {
          const chunks = [];
          res2.on('data', c => chunks.push(c));
          res2.on('end', () => {
            try { resolve({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
            catch (e) { resolve({ ok: false, error: e.message }); }
          });
        });
        req2.on('error', e => resolve({ ok: false, error: e.message }));
        req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'timeout' }); });
      });
      results.proxy_isp = { url: `${ISP_PROXY_HOST}:${ISP_PROXY_PORT}`, ...ispTest };
    } catch (e) {
      results.proxy_isp = { ok: false, error: e.message };
    }
  } else {
    results.proxy_isp = { ok: false, error: 'ISP_PROXY_* vars not set' };
  }

  res.json({ ok: true, env: envSnapshot, tests: results });
});

// POST /admin/fix-macys-urls — append ?ID= to broken Macy's product_url rows
// Macy's xapi used to return /shop/product/slug without ?ID=.
// The product SKU IS the numeric product ID, so we can reconstruct correct URLs.
router.post('/fix-macys-urls', async (req, res) => {
  try {
    const preview = req.query.preview === '1';

    // Count affected rows first
    const countRes = await query(`
      SELECT COUNT(*) AS n FROM products p
      JOIN stores s ON p.store_id = s.id
      WHERE s.slug = 'macys'
        AND p.product_url IS NOT NULL
        AND p.product_url NOT LIKE '%?ID=%'
        AND p.product_url NOT LIKE '%&ID=%'
        AND p.sku ~ '^[0-9]+$'
    `);
    const affected = parseInt(countRes.rows[0]?.n || 0);

    if (preview || affected === 0) {
      return res.json({ ok: true, preview: true, affected, message: `${affected} rows would be updated` });
    }

    const updateRes = await query(`
      UPDATE products p
      SET product_url = p.product_url || '?ID=' || p.sku,
          updated_at  = NOW()
      FROM stores s
      WHERE p.store_id = s.id
        AND s.slug = 'macys'
        AND p.product_url IS NOT NULL
        AND p.product_url NOT LIKE '%?ID=%'
        AND p.product_url NOT LIKE '%&ID=%'
        AND p.sku ~ '^[0-9]+$'
    `);

    res.json({ ok: true, updated: updateRes.rowCount, message: `Fixed ${updateRes.rowCount} Macy's product URLs` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/ensure-stores — upsert all 15 discovery stores (idempotent)
router.post('/ensure-stores', async (req, res) => {
  const STORES = [
    { name: 'Best Buy',       slug: 'best-buy',       color: '#003087', website_url: 'https://www.bestbuy.com' },
    { name: 'Target',         slug: 'target',         color: '#CC0000', website_url: 'https://www.target.com' },
    { name: 'Walmart',        slug: 'walmart',        color: '#0071CE', website_url: 'https://www.walmart.com' },
    { name: 'Home Depot',     slug: 'home-depot',     color: '#F96302', website_url: 'https://www.homedepot.com' },
    { name: "Lowe's",         slug: 'lowes',          color: '#004990', website_url: 'https://www.lowes.com' },
    { name: "Macy's",         slug: 'macys',          color: '#E21A2C', website_url: 'https://www.macys.com' },
    { name: 'GameStop',       slug: 'gamestop',       color: '#5D1DB6', website_url: 'https://www.gamestop.com' },
    { name: 'Office Depot',   slug: 'office-depot',   color: '#C8102E', website_url: 'https://www.officedepot.com' },
    { name: 'Staples',        slug: 'staples',        color: '#CC0000', website_url: 'https://www.staples.com' },
    { name: "Kohl's",         slug: 'kohls',          color: '#CC0000', website_url: 'https://www.kohls.com' },
    { name: 'Nordstrom Rack', slug: 'nordstrom-rack', color: '#001E5B', website_url: 'https://www.nordstromrack.com' },
    { name: 'TJ Maxx',        slug: 'tj-maxx',        color: '#E31837', website_url: 'https://www.tjmaxx.tjx.com' },
    { name: 'Marshalls',      slug: 'marshalls',      color: '#C41230', website_url: 'https://www.marshalls.com' },
    { name: 'Burlington',     slug: 'burlington',     color: '#CC0000', website_url: 'https://www.burlington.com' },
    { name: 'Costco',         slug: 'costco',         color: '#005DAA', website_url: 'https://www.costco.com' },
  ];
  const results = [];
  for (const s of STORES) {
    try {
      const r = await query(
        `INSERT INTO stores (name, slug, color, website_url, is_active)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, website_url=EXCLUDED.website_url, is_active=true
         RETURNING id, slug`,
        [s.name, s.slug, s.color, s.website_url]
      );
      results.push({ slug: s.slug, ok: true, id: r.rows[0]?.id });
    } catch (err) {
      results.push({ slug: s.slug, ok: false, error: err.message });
    }
  }
  const failed = results.filter(r => !r.ok);
  res.json({ ok: failed.length === 0, results, failed_count: failed.length });
});

// GET /admin/discovery-runs — last discovery result per store
// Reads from worker_store_runs (detailed) with fallback to legacy discovery_runs
router.get('/discovery-runs', async (req, res) => {
  try {
    // Try worker_store_runs first (new detailed table)
    const r = await query(`
      SELECT DISTINCT ON (store_slug)
        store_slug AS store,
        pages_visited, urls_discovered, urls_new, saved, errors, blocked,
        block_type, last_error, proxy_used, screenshot_path,
        duration_seconds, commit_sha,
        completed_at AS ran_at
      FROM worker_store_runs
      ORDER BY store_slug, completed_at DESC
    `);
    if (r.rows.length > 0) return res.json({ ok: true, runs: r.rows, source: 'worker_store_runs' });
    throw new Error('empty');
  } catch (newErr) {
    // Fallback to legacy discovery_runs table
    try {
      const r = await query(`
        SELECT store, pages_visited, urls_discovered, urls_new, saved, 0 AS no_price,
               errors, blocked, last_error, ran_at
        FROM discovery_runs
        ORDER BY ran_at DESC
      `);
      return res.json({ ok: true, runs: r.rows, source: 'discovery_runs' });
    } catch (err) {
      if (err.message.includes('does not exist')) return res.json({ ok: true, runs: [], note: 'no run data yet' });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// GET /admin/store-audit/:slug — full data health audit for one store
router.get('/store-audit/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const [
      totals,
      inactiveBreakdown,
      latestProducts,
      latestDeals,
      sampleProducts,
    ] = await Promise.all([
      // Totals: products, prices, deals, active_deals, products_without_prices, products_without_regular_price
      query(`
        SELECT
          COUNT(DISTINCT p.id)                                                           AS total_products,
          COUNT(DISTINCT pr.product_id)                                                  AS products_with_prices,
          COUNT(DISTINCT p.id) - COUNT(DISTINCT pr.product_id)                          AS products_without_prices,
          COUNT(DISTINCT pr.id)                                                          AS total_prices,
          COUNT(DISTINCT d.id)                                                           AS total_deals,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = true)                        AS active_deals,
          COUNT(DISTINCT d.id) FILTER (WHERE d.regular_price IS NULL)                   AS products_without_regular_price,
          COUNT(DISTINCT d.id) FILTER (WHERE d.regular_price IS NOT NULL AND d.discount_percent < 20 AND d.is_active = false) AS deals_inactive_by_discount,
          COUNT(DISTINCT d.id) FILTER (WHERE d.regular_price IS NOT NULL AND d.discount_percent >= 20
                                          AND (d.estimated_profit <= 0 OR d.roi_percent <= 0) AND d.is_active = false) AS deals_inactive_by_profit
        FROM stores s
        JOIN products p ON p.store_id = s.id
        LEFT JOIN prices pr ON pr.product_id = p.id
        LEFT JOIN deals d ON d.product_id = p.id AND d.store_id = s.id
        WHERE s.slug = $1
      `, [slug]),

      // Inactive deal count by reason
      query(`
        SELECT
          SUM(CASE WHEN d.regular_price IS NULL THEN 1 ELSE 0 END)                                                              AS no_regular_price,
          SUM(CASE WHEN d.regular_price IS NOT NULL AND d.discount_percent < 20 THEN 1 ELSE 0 END)                              AS low_discount,
          SUM(CASE WHEN d.regular_price IS NOT NULL AND d.discount_percent >= 20
                        AND d.estimated_profit IS NOT NULL AND d.estimated_profit <= 0 THEN 1 ELSE 0 END)                        AS no_profit,
          SUM(CASE WHEN d.regular_price IS NOT NULL AND d.discount_percent >= 20
                        AND (d.estimated_profit IS NULL OR d.estimated_profit > 0)
                        AND (d.roi_percent IS NULL OR d.roi_percent <= 0) THEN 1 ELSE 0 END)                                      AS no_roi
        FROM deals d
        JOIN products p ON d.product_id = p.id
        JOIN stores s ON s.id = d.store_id
        WHERE s.slug = $1 AND d.is_active = false
      `, [slug]),

      // Latest 5 products by created_at
      query(`
        SELECT p.id, p.name, p.sku, p.created_at
        FROM products p JOIN stores s ON p.store_id = s.id
        WHERE s.slug = $1
        ORDER BY p.created_at DESC LIMIT 5
      `, [slug]),

      // Latest 5 deals by last_seen_at
      query(`
        SELECT d.id, p.name, d.deal_price, d.regular_price, d.discount_percent,
               d.estimated_profit, d.roi_percent, d.is_active, d.last_seen_at
        FROM deals d
        JOIN products p ON d.product_id = p.id
        JOIN stores s ON d.store_id = s.id
        WHERE s.slug = $1
        ORDER BY d.last_seen_at DESC LIMIT 5
      `, [slug]),

      // Sample 20 products with inactive_reason
      query(`
        SELECT
          p.name,
          d.deal_price     AS current_price,
          d.regular_price,
          d.discount_percent,
          d.estimated_profit,
          d.roi_percent,
          d.is_active,
          CASE
            WHEN d.id IS NULL                              THEN 'no_deal_row'
            WHEN d.is_active = true                        THEN 'active'
            WHEN d.regular_price IS NULL                   THEN 'no_regular_price'
            WHEN d.discount_percent < 20                   THEN 'discount_too_low_' || ROUND(d.discount_percent::numeric, 1) || 'pct'
            WHEN d.estimated_profit IS NOT NULL AND d.estimated_profit <= 0 THEN 'no_profit_' || ROUND(d.estimated_profit::numeric, 2)
            WHEN d.roi_percent IS NOT NULL AND d.roi_percent <= 0 THEN 'no_roi_' || ROUND(d.roi_percent::numeric, 2) || 'pct'
            ELSE 'unknown'
          END AS inactive_reason
        FROM products p
        JOIN stores s ON p.store_id = s.id
        LEFT JOIN deals d ON d.product_id = p.id AND d.store_id = s.id
        WHERE s.slug = $1
        ORDER BY d.last_seen_at DESC NULLS LAST
        LIMIT 20
      `, [slug]),
    ]);

    if (!totals.rows[0]) return res.status(404).json({ ok: false, error: `Store not found: ${slug}` });

    const t = totals.rows[0];
    const ib = inactiveBreakdown.rows[0] || {};

    res.json({
      ok: true,
      store_slug: slug,
      total_products:                 parseInt(t.total_products),
      total_prices:                   parseInt(t.total_prices),
      total_deals:                    parseInt(t.total_deals),
      active_deals:                   parseInt(t.active_deals),
      products_without_prices:        parseInt(t.products_without_prices),
      products_without_regular_price: parseInt(t.products_without_regular_price),
      deals_inactive_by_discount:     parseInt(t.deals_inactive_by_discount),
      deals_inactive_by_profit:       parseInt(t.deals_inactive_by_profit),
      inactive_breakdown: {
        no_regular_price: parseInt(ib.no_regular_price || 0),
        low_discount:     parseInt(ib.low_discount || 0),
        no_profit:        parseInt(ib.no_profit || 0),
        no_roi:           parseInt(ib.no_roi || 0),
      },
      is_active_condition: 'regular_price IS NOT NULL AND discount_percent >= 20 AND estimated_profit > 0 AND roi_percent > 0',
      latest_products: latestProducts.rows,
      latest_deals:    latestDeals.rows,
      sample_products: sampleProducts.rows,
    });
  } catch (err) {
    console.error('[store-audit]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Discovery Job Queue (web-safe — no Playwright) ──────────────────────────

// POST /admin/discovery-jobs — enqueue a discovery run for the worker to pick up
router.post('/discovery-jobs', async (req, res) => {
  const { store } = req.body;
  if (!store) return res.status(400).json({ ok: false, error: 'store required in body' });
  try {
    const { enqueueJob } = require('../services/discoveryQueue');
    const result = await enqueueJob(store, req.user?.email || req.user?.id || 'admin');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[discovery-jobs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/discovery-jobs/latest?store=xxx — latest job for a store
router.get('/discovery-jobs/latest', async (req, res) => {
  const { store } = req.query;
  try {
    const { getLatestJob } = require('../services/discoveryQueue');
    const job = await getLatestJob(store || null);
    res.json({ ok: true, job: job || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/discovery-jobs — list recent jobs (optional ?store=xxx&limit=20)
router.get('/discovery-jobs', async (req, res) => {
  const { store, limit } = req.query;
  try {
    const { listJobs } = require('../services/discoveryQueue');
    const jobs = await listJobs({ storeSlug: store || null, limit: Math.min(parseInt(limit) || 20, 100) });
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/recalculate-deals/:slug — reapply is_active rules to existing deals without re-scraping
// New rules: discount >= 30% → active regardless of profit; 20-29.99% → needs profit+roi > 0; < 20% → inactive
router.post('/recalculate-deals/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const r = await query(`
      UPDATE deals SET
        is_active = CASE
          WHEN is_error_price = true                                                THEN true
          WHEN discount_percent >= 30                                               THEN true
          WHEN regular_price IS NOT NULL
            AND discount_percent >= 20
            AND estimated_profit > 0
            AND roi_percent > 0                                                    THEN true
          ELSE false
        END,
        expires_at = CASE
          WHEN is_error_price = true OR discount_percent >= 30
            OR (regular_price IS NOT NULL AND discount_percent >= 20
                AND estimated_profit > 0 AND roi_percent > 0)
          THEN NOW() + INTERVAL '48 hours'
          ELSE expires_at
        END
      FROM products p, stores s
      WHERE deals.product_id = p.id
        AND deals.store_id   = s.id
        AND s.slug = $1
      RETURNING deals.id, deals.is_active, deals.discount_percent, deals.estimated_profit, deals.roi_percent
    `, [slug]);

    const total    = r.rowCount;
    const active   = r.rows.filter(row => row.is_active).length;
    const inactive = total - active;

    res.json({
      ok: true,
      store: slug,
      total_deals_updated: total,
      now_active:          active,
      now_inactive:        inactive,
      breakdown: {
        high_discount_override: r.rows.filter(row => row.is_active && parseFloat(row.discount_percent) >= 30).length,
        profit_qualified:       r.rows.filter(row => row.is_active && parseFloat(row.discount_percent) < 30).length,
      },
    });
  } catch (err) {
    console.error('[recalculate-deals]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/worker-runs — recent cycle history
router.get('/worker-runs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const r = await query(
      'SELECT * FROM worker_runs ORDER BY period_start DESC LIMIT $1', [limit]
    );
    res.json({ ok: true, runs: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/proxy-url-test?url=<target> — fetch a URL via buildHttpProxyAgent() and return raw diagnostics
// Uses the EXACT same agent factory as officeDepotDiscovery to isolate proxy vs scraper issues.
router.get('/proxy-url-test', async (req, res) => {
  const https = require('https');
  const http  = require('http');
  const { buildHttpProxyAgent } = require('../utils/proxyUtils');

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'url query param required' });

  const agent = buildHttpProxyAgent('ProxyUrlTest');
  const host  = process.env.PROXY_HOST || null;
  const port  = parseInt(process.env.PROXY_PORT) || 22225;
  const user  = process.env.PROXY_USER || '';

  const proxyMeta = {
    proxy_host:         host,
    proxy_port:         port,
    proxy_user_partial: user ? user.slice(0, 30) + '...' : '(not set)',
    agent_created:      !!agent,
  };

  const result = await new Promise(resolve => {
    const lib  = targetUrl.startsWith('https:') ? https : http;
    const opts = {
      timeout: 20000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };
    if (agent) opts.agent = agent;

    const req2 = lib.get(targetUrl, opts, res2 => {
      const chunks = [];
      res2.on('data', c => chunks.push(c));
      res2.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          http_status:      res2.statusCode,
          response_headers: res2.headers,
          first_200_chars:  body.slice(0, 200),
          error_message:    null,
        });
      });
      res2.on('error', e => resolve({ http_status: null, response_headers: null, first_200_chars: null, error_message: e.message }));
    });
    req2.on('error', e => resolve({ http_status: null, response_headers: null, first_200_chars: null, error_message: e.message }));
    req2.on('timeout', () => { req2.destroy(); resolve({ http_status: null, response_headers: null, first_200_chars: null, error_message: 'timeout' }); });
  });

  res.json({ ok: result.http_status === 200, target_url: targetUrl, ...proxyMeta, ...result });
});

// GET /admin/worker-proxy-test — tests BrightData proxy connectivity from the WORKER process
// Uses buildHttpProxyAgent('OfficeDept'), identical to officeDepotDiscovery.js, to confirm
// whether the 407 is a worker-side env/config issue vs a BrightData auth issue.
router.get('/worker-proxy-test', workerOnly, async (req, res) => {
  const https = require('https');
  const http  = require('http');
  const { buildHttpProxyAgent } = require('../utils/proxyUtils');

  const TEST_URLS = [
    'https://geo.brdtest.com/welcome.txt',
    'https://lumtest.com/myip.json',
    'https://www.officedepot.com/product_sitemap_0.xml',
  ];

  const host = process.env.PROXY_HOST  || null;
  const port = parseInt(process.env.PROXY_PORT) || 22225;
  const user = process.env.PROXY_USER  || '';
  const pass = process.env.PROXY_PASS  || '';

  const agent = buildHttpProxyAgent('OfficeDept');

  const proxyMeta = {
    proxy_host:         host,
    proxy_port:         port,
    proxy_user_partial: user ? user.slice(0, 40) + '...' : '(not set)',
    proxy_pass_set:     !!pass,
    proxy_enabled:      process.env.PROXY_ENABLED,
    agent_created:      !!agent,
  };

  function classifyError(msg, statusCode) {
    if (statusCode === 407 || (msg || '').includes('407')) return 'PROXY_AUTH_407';
    const m = (msg || '').toLowerCase();
    if (m.includes('etimedout') || m.includes('timeout'))                     return 'TIMEOUT';
    if (m.includes('cert') || m.includes('tls') || m.includes('ssl'))         return 'TLS';
    if (m.includes('enotfound') || m.includes('dns'))                         return 'DNS';
    if (m.includes('econnrefused') || m.includes('econnreset') || m.includes('socket hang up')) return 'CONNECTION';
    return 'UNKNOWN';
  }

  async function testUrl(targetUrl) {
    const t0 = Date.now();
    return new Promise(resolve => {
      const lib  = targetUrl.startsWith('https:') ? https : http;
      const opts = {
        timeout: 25000,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      };
      if (agent) opts.agent = agent;

      const onError = (errMsg, statusCode = null) => resolve({
        url:         targetUrl,
        ok:          false,
        http_status: statusCode,
        ip:          null,
        country:     null,
        elapsed_ms:  Date.now() - t0,
        body_snippet: null,
        error: {
          message: errMsg,
          type:    classifyError(errMsg, statusCode),
        },
      });

      const req2 = lib.get(targetUrl, opts, res2 => {
        const chunks = [];
        res2.on('data', c => chunks.push(c));
        res2.on('end', () => {
          const elapsed = Date.now() - t0;
          const body    = Buffer.concat(chunks).toString('utf8');

          if (res2.statusCode !== 200) {
            return resolve({
              url:         targetUrl,
              ok:          false,
              http_status: res2.statusCode,
              ip:          null,
              country:     null,
              elapsed_ms:  elapsed,
              body_snippet: body.slice(0, 500),
              error: {
                message: `HTTP ${res2.statusCode}`,
                type:    classifyError(`HTTP ${res2.statusCode}`, res2.statusCode),
              },
            });
          }

          let ip = null, country = null;
          try {
            const parsed = JSON.parse(body);
            ip      = parsed.ip      || parsed.clientIp   || null;
            country = parsed.country || parsed.countryCode || null;
          } catch { /* not JSON — try text patterns */ }

          if (!ip) {
            const ipM  = body.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
            const cntM = body.match(/Country[:\s]+([A-Z]{2,})/i);
            ip      = ipM?.[1]  || null;
            country = cntM?.[1] || null;
          }

          resolve({
            url:         targetUrl,
            ok:          true,
            http_status: res2.statusCode,
            ip,
            country,
            elapsed_ms:  elapsed,
            body_snippet: body.slice(0, 500),
            error:       null,
          });
        });
        res2.on('error', e => onError(e.message));
      });

      req2.on('error',   e  => onError(e.message));
      req2.on('timeout', () => { req2.destroy(); onError('timeout'); });
    });
  }

  const results = await Promise.all(TEST_URLS.map(testUrl));
  const allOk   = results.every(r => r.ok);

  res.json({
    ok:    allOk,
    proxy: proxyMeta,
    tests: results,
  });
});

module.exports = router;

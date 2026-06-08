const express = require('express');
const https = require('https');
const http = require('http');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

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
router.post('/scan', async (req, res) => {
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
router.post('/discovery', async (req, res) => {
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
router.get('/test-discovery/:store', async (req, res) => {
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
router.get('/test-browser', async (req, res) => {
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
router.get('/test-links', async (req, res) => {
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
router.get('/test-scraper/:store', async (req, res) => {
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

module.exports = router;

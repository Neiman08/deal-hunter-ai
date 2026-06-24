const express = require('express');
const https = require('https');
const http = require('http');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');

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

// GET /admin/scanner-stats
router.get('/scanner-stats', async (req, res) => {
  try {
    const [history, unknown, keepaCache, recovered] = await Promise.all([
      // Scanner history breakdown
      query(`
        SELECT
          COUNT(*)                                              AS total_scans,
          COUNT(*) FILTER (WHERE found_internal)               AS found_internal,
          COUNT(*) FILTER (WHERE keepa_asin IS NOT NULL)       AS keepa_matched,
          COUNT(*) FILTER (WHERE keepa_confidence >= 60)       AS keepa_high_confidence,
          COUNT(*) FILTER (WHERE in_store_price IS NOT NULL)   AS scans_with_price,
          COUNT(DISTINCT user_id)                              AS unique_users,
          COUNT(DISTINCT DATE(scanned_at))                     AS active_days,
          MAX(scanned_at)                                      AS last_scan_at
        FROM scanner_history
      `),
      // Unknown UPC queue stats
      query(`
        SELECT
          COUNT(*)                                              AS total_unknown,
          SUM(scans_count)                                     AS total_unknown_scans,
          COUNT(*) FILTER (WHERE recovery_found)               AS recovery_hits,
          COUNT(*) FILTER (WHERE high_priority)                AS high_priority_count,
          COUNT(*) FILTER (WHERE recovery_attempted AND NOT recovery_found) AS recovery_misses,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE recovery_found)
            / NULLIF(COUNT(*) FILTER (WHERE recovery_attempted), 0), 1
          )                                                    AS recovery_hit_rate_pct
        FROM scanner_unknown_products
      `),
      // Keepa market data coverage
      query(`
        SELECT
          COUNT(*)                                                                  AS total_cached,
          COUNT(*) FILTER (WHERE effective_market_price IS NOT NULL)               AS with_price,
          COUNT(*) FILTER (WHERE effective_market_source = 'buy_box')              AS buy_box_count,
          COUNT(*) FILTER (WHERE effective_market_source = 'amazon_current')       AS current_count,
          COUNT(*) FILTER (WHERE effective_market_source IN ('amazon_90d_avg','amazon_180d_avg')) AS avg_only_count,
          COUNT(*) FILTER (WHERE effective_market_price IS NULL)                   AS no_price_count
        FROM product_market_data
        WHERE source = 'keepa'
          AND fetched_at > NOW() - INTERVAL '7 days'
      `),
      // Top recovered UPCs
      query(`
        SELECT upc, scans_count, recovery_source,
          (recovery_data->>'title')  AS title,
          (recovery_data->>'brand')  AS brand
        FROM scanner_unknown_products
        WHERE recovery_found = true
        ORDER BY scans_count DESC
        LIMIT 10
      `),
    ]);

    // Top unknown (not recovered) UPCs
    const topUnknown = await query(`
      SELECT upc, scans_count, high_priority, last_seen
      FROM scanner_unknown_products
      WHERE recovery_found = false
      ORDER BY scans_count DESC
      LIMIT 10
    `);

    // Scans per day (last 14 days)
    const scansByDay = await query(`
      SELECT DATE(scanned_at) AS day, COUNT(*) AS scans
      FROM scanner_history
      WHERE scanned_at > NOW() - INTERVAL '14 days'
      GROUP BY day
      ORDER BY day DESC
    `);

    const h = history.rows[0];
    const u = unknown.rows[0];
    const k = keepaCache.rows[0];

    const totalScans   = parseInt(h.total_scans)   || 0;
    const keepaMatched = parseInt(h.keepa_matched)  || 0;
    const foundInternal= parseInt(h.found_internal) || 0;
    const totalUnknown = parseInt(u.total_unknown)  || 0;
    const recoveryHits = parseInt(u.recovery_hits)  || 0;

    const recognitionRate = totalScans > 0
      ? Math.round(100 * (foundInternal + keepaMatched) / totalScans)
      : null;

    res.json({
      scanner: {
        total_scans:          totalScans,
        found_internal:       foundInternal,
        keepa_matched:        keepaMatched,
        keepa_high_confidence:parseInt(h.keepa_high_confidence) || 0,
        scans_with_price:     parseInt(h.scans_with_price) || 0,
        unique_users:         parseInt(h.unique_users)     || 0,
        active_days:          parseInt(h.active_days)      || 0,
        last_scan_at:         h.last_scan_at,
        recognition_rate_pct: recognitionRate,
      },
      unknown_queue: {
        total_unique_upcs:     totalUnknown,
        total_unknown_scans:   parseInt(u.total_unknown_scans) || 0,
        recovery_hits:         recoveryHits,
        recovery_misses:       parseInt(u.recovery_misses) || 0,
        high_priority_count:   parseInt(u.high_priority_count) || 0,
        recovery_hit_rate_pct: parseFloat(u.recovery_hit_rate_pct) || 0,
      },
      keepa_cache: {
        total_cached:     parseInt(k.total_cached)     || 0,
        with_price:       parseInt(k.with_price)       || 0,
        no_price:         parseInt(k.no_price_count)   || 0,
        buy_box_count:    parseInt(k.buy_box_count)    || 0,
        current_count:    parseInt(k.current_count)    || 0,
        avg_only_count:   parseInt(k.avg_only_count)   || 0,
      },
      top_unknown_upcs:   topUnknown.rows,
      top_recovered_upcs: recovered.rows,
      scans_by_day:       scansByDay.rows,
    });
  } catch (err) {
    logger.error(`[Admin] scanner-stats error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/scan-logs
router.get('/scan-logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const r = await query(`
      SELECT sl.id, sl.status, sl.products_scanned, sl.deals_found, sl.errors_count,
             sl.duration_seconds, sl.started_at, sl.completed_at,
             sl.store_name AS cycle_label,
             sl.error_details,
             s.name AS store_name, s.slug AS store_slug
      FROM scan_logs sl LEFT JOIN stores s ON sl.store_id = s.id
      ORDER BY sl.started_at DESC LIMIT $1
    `, [limit]);
    const logs = r.rows.map(row => ({
      ...row,
      error_details: (() => {
        if (!row.error_details) return null;
        try { return JSON.parse(row.error_details); } catch { return row.error_details; }
      })(),
    }));
    // Aggregate stats
    const total = logs.length;
    const success  = logs.filter(l => l.status === 'success').length;
    const partial  = logs.filter(l => l.status === 'partial').length;
    const errored  = logs.filter(l => l.status === 'error').length;
    const running  = logs.filter(l => l.status === 'running').length;
    res.json({
      logs,
      summary: { total, success, partial, errored, running,
        success_rate_pct: total > 0 ? Math.round((success + partial) / total * 100) : null },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/scan-health — scan success rate, circuit breaker state, proxy check
router.get('/scan-health', authenticate, requireAdmin, async (req, res) => {
  try {
    const { _circuit, checkProxyConnectivity } = require('../jobs/scanJob');

    // Last 48 scans stats
    const statsR = await query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE status = 'success')           AS success,
        COUNT(*) FILTER (WHERE status = 'partial')           AS partial,
        COUNT(*) FILTER (WHERE status = 'error')             AS errored,
        COUNT(*) FILTER (WHERE status = 'running')           AS running,
        MAX(CASE WHEN status IN ('success','partial') THEN started_at END) AS last_success_at,
        MAX(CASE WHEN status = 'error' THEN started_at END)  AS last_error_at,
        ROUND(AVG(duration_seconds) FILTER (WHERE status IN ('success','partial','error')), 0) AS avg_duration_s,
        SUM(products_scanned)                                AS total_products_scanned,
        SUM(deals_found)                                     AS total_deals_found
      FROM scan_logs
      WHERE started_at > NOW() - INTERVAL '24 hours'
    `);

    // Proxy check
    let proxyStatus = { ok: null, note: 'not checked' };
    if (checkProxyConnectivity) {
      proxyStatus = await checkProxyConnectivity().catch(e => ({ ok: false, error: e.message }));
    }

    // Circuit breaker state
    const circuitState = {};
    if (_circuit) {
      for (const [store, c] of _circuit.entries()) {
        if (c.failures > 0 || c.pausedUntil) {
          circuitState[store] = {
            failures: c.failures,
            open: c.pausedUntil ? Date.now() < c.pausedUntil : false,
            resumes_at: c.pausedUntil ? new Date(c.pausedUntil).toISOString() : null,
          };
        }
      }
    }

    const s = statsR.rows[0];
    const total = parseInt(s.total) || 0;
    res.json({
      ok: true,
      period: '24h',
      scans: {
        total, success: parseInt(s.success), partial: parseInt(s.partial),
        errored: parseInt(s.errored), running: parseInt(s.running),
        success_rate_pct: total > 0 ? Math.round((parseInt(s.success) + parseInt(s.partial)) / total * 100) : null,
        last_success_at: s.last_success_at, last_error_at: s.last_error_at,
        avg_duration_s: parseInt(s.avg_duration_s) || null,
        total_products_scanned: parseInt(s.total_products_scanned) || 0,
        total_deals_found: parseInt(s.total_deals_found) || 0,
      },
      proxy: proxyStatus,
      circuit_breaker: Object.keys(circuitState).length ? circuitState : { note: 'no open circuits' },
    });
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

// POST /admin/discovery-jobs/:id/cancel — force-fail a stuck 'running' or 'pending' job
router.post('/discovery-jobs/:id/cancel', async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (!jobId) return res.status(400).json({ ok: false, error: 'invalid job id' });
  try {
    const { query: dbQuery } = require('../config/database');
    const r = await dbQuery(
      `UPDATE discovery_jobs SET status='failed', completed_at=NOW(), error='cancelled by admin'
       WHERE id=$1 AND status IN ('pending','running') RETURNING id, status`,
      [jobId]
    );
    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'job not found or already completed' });
    res.json({ ok: true, cancelled: r.rows[0] });
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

// ── Keepa Admin Endpoints ─────────────────────────────────────────────────────

// GET /admin/keepa-status
router.get('/keepa-status', async (req, res) => {
  const { isEnabled } = require('../services/external/keepaService');
  try {
    const statsRes = await query(`
      SELECT COUNT(*) as total,
        MAX(fetched_at) as last_fetch_at,
        COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '24 hours') as fresh_count
      FROM product_market_data WHERE source = 'keepa'
    `).catch(() => ({ rows: [{ total: 0, last_fetch_at: null, fresh_count: 0 }] }));

    const row = statsRes.rows[0];
    res.json({
      ok: true,
      enabled: process.env.KEEPA_ENABLED !== 'false',
      configured: !!process.env.KEEPA_API_KEY,
      cache_hours: parseFloat(process.env.KEEPA_CACHE_HOURS || '24'),
      domain: process.env.KEEPA_DOMAIN || '1',
      products_with_keepa_data: parseInt(row.total) || 0,
      fresh_products_24h: parseInt(row.fresh_count) || 0,
      last_fetch_at: row.last_fetch_at || null,
      tokens_note: 'Keepa token balance not fetched automatically to avoid token waste. Rate limit: 10 calls/min (internal).',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/keepa/test — test with a known ASIN (cheap call)
router.post('/keepa/test', async (req, res) => {
  const { lookupByAsin } = require('../services/external/keepaService');
  const testAsin = req.body.asin || 'B07PFFMP9P'; // Amazon staging ASIN — reliable for connectivity test (always has price data)
  try {
    const result = await lookupByAsin(testAsin, { skipCache: false });
    res.json({ ok: true, asin_tested: testAsin, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/products/:id/enrich-keepa
router.post('/products/:id/enrich-keepa', async (req, res) => {
  const { enrichProductWithKeepa } = require('../services/external/keepaService');
  const productId = req.params.id;
  try {
    const productRes = await query('SELECT * FROM products WHERE id = $1', [productId]);
    if (!productRes.rows.length) return res.status(404).json({ error: 'Product not found' });

    const product = productRes.rows[0];
    const result = await enrichProductWithKeepa(product, { productId, skipCache: true });
    res.json({ ok: true, product_id: productId, keepa: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/run-quality-backfill
// Runs the quality classification entirely in SQL — no external HTTP, no Playwright.
// Safe to call in production. Returns counts of what changed.
router.post('/run-quality-backfill', async (req, res) => {
  try {
    logger.info('[Admin] run-quality-backfill triggered');

    // Ensure columns exist first
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_status        VARCHAR(30)  DEFAULT NULL`);
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_reason        TEXT         DEFAULT NULL`);
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_public_visible     BOOLEAN      DEFAULT NULL`);
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS last_quality_check_at TIMESTAMPTZ  DEFAULT NULL`);

    const result = await query(`
      UPDATE products p SET
        quality_status = CASE
          WHEN trim(COALESCE(p.name, '')) = '' OR length(trim(COALESCE(p.name, ''))) < 5
            THEN 'HIDDEN_MISSING_TITLE'
          WHEN trim(p.name) ~* '^gamestop product[[:space:]]+[0-9]+$'
            OR trim(p.name) ~* '^product[[:space:]]+[0-9]+$'
            OR trim(p.name) ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
            OR trim(p.name) ~ '^[0-9]{5,}$'
            THEN 'HIDDEN_GENERIC_TITLE'
          WHEN (p.product_url LIKE '%macys.com%')
               AND (p.product_url NOT LIKE '%?ID=%')
               AND (p.product_url NOT LIKE '%/ID/%')
            THEN 'HIDDEN_BROKEN_URL'
          WHEN p.product_url IS NULL OR trim(p.product_url) = ''
            THEN 'INCOMPLETE_PRODUCT'
          WHEN p.image_url IS NULL OR trim(p.image_url) = ''
            THEN 'NEEDS_IMAGE'
          ELSE 'PASS'
        END,
        is_public_visible = CASE
          WHEN trim(COALESCE(p.name, '')) = '' OR length(trim(COALESCE(p.name, ''))) < 5
            THEN false
          WHEN trim(p.name) ~* '^gamestop product[[:space:]]+[0-9]+$'
            OR trim(p.name) ~* '^product[[:space:]]+[0-9]+$'
            OR trim(p.name) ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
            OR trim(p.name) ~ '^[0-9]{5,}$'
            THEN false
          WHEN (p.product_url LIKE '%macys.com%')
               AND (p.product_url NOT LIKE '%?ID=%')
               AND (p.product_url NOT LIKE '%/ID/%')
            THEN false
          WHEN p.product_url IS NULL OR trim(p.product_url) = ''
            THEN false
          ELSE true
        END,
        quality_reason = CASE
          WHEN trim(COALESCE(p.name, '')) = '' OR length(trim(COALESCE(p.name, ''))) < 5
            THEN 'Empty or too-short product name'
          WHEN trim(p.name) ~* '^(gamestop |[a-z]{2,12} )?product[[:space:]]+[0-9]+$'
            THEN 'Placeholder name: ' || trim(p.name)
          WHEN trim(p.name) ~ '^[0-9]{5,}$'
            THEN 'Numeric-only name: ' || trim(p.name)
          WHEN (p.product_url LIKE '%macys.com%')
               AND (p.product_url NOT LIKE '%?ID=%')
               AND (p.product_url NOT LIKE '%/ID/%')
            THEN 'Macy''s URL missing product ID — will 404 in browser'
          WHEN p.product_url IS NULL OR trim(p.product_url) = ''
            THEN 'No product URL'
          WHEN p.image_url IS NULL OR trim(p.image_url) = ''
            THEN 'No image — flagged for enrichment'
          ELSE NULL
        END,
        last_quality_check_at = NOW(),
        updated_at = NOW()
      RETURNING p.id, p.quality_status, p.is_public_visible
    `);

    const rows = result.rows;
    const summary = {};
    for (const r of rows) {
      summary[r.quality_status] = (summary[r.quality_status] || 0) + 1;
    }
    const hidden = rows.filter(r => r.is_public_visible === false).length;

    logger.info(`[Admin] run-quality-backfill done: ${rows.length} classified, ${hidden} hidden`);
    res.json({
      ok: true,
      total_classified: rows.length,
      hidden_from_feed: hidden,
      by_status: summary,
    });
  } catch (err) {
    logger.error(`[Admin] run-quality-backfill error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/feed-quality
router.get('/feed-quality', async (req, res) => {
  try {
    const [overview, byStore, topIssues] = await Promise.all([
      query(`
        SELECT
          COUNT(*)                                                                          AS total_products,
          COUNT(*) FILTER (WHERE d.is_active)                                              AS total_deals,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active AND p.is_public_visible = true
                                       AND p.quality_status IN ('PASS', 'NEEDS_IMAGE'))    AS public_visible_deals,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active AND p.is_public_visible = false)  AS hidden_by_quality,
          COUNT(*) FILTER (WHERE p.quality_status IS NULL)                                 AS unchecked,
          COUNT(*) FILTER (WHERE p.quality_status = 'PASS')                               AS pass,
          COUNT(*) FILTER (WHERE p.quality_status = 'HIDDEN_GENERIC_TITLE')               AS generic_title,
          COUNT(*) FILTER (WHERE p.quality_status = 'HIDDEN_MISSING_TITLE')               AS missing_title,
          COUNT(*) FILTER (WHERE p.quality_status = 'HIDDEN_BROKEN_URL')                  AS broken_url,
          COUNT(*) FILTER (WHERE p.quality_status = 'NEEDS_IMAGE')                        AS needs_image,
          COUNT(*) FILTER (WHERE p.quality_status = 'INCOMPLETE_PRODUCT')                 AS incomplete_product,
          COUNT(*) FILTER (WHERE p.quality_status = 'NEEDS_RECOVERY')                     AS needs_recovery,
          COUNT(*) FILTER (WHERE p.quality_status = 'MANUAL_REVIEW')                      AS manual_review
        FROM products p
        LEFT JOIN deals d ON d.product_id = p.id
      `),
      query(`
        SELECT
          s.name AS store,
          s.slug AS store_slug,
          COUNT(DISTINCT p.id)                                                                          AS total_products,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active)                                              AS active_deals,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active AND p.is_public_visible = true
                                       AND p.quality_status IN ('PASS', 'NEEDS_IMAGE'))               AS public_deals,
          COUNT(DISTINCT p.id) FILTER (WHERE p.is_public_visible = false)                              AS hidden_products,
          COUNT(DISTINCT p.id) FILTER (WHERE p.quality_status = 'HIDDEN_GENERIC_TITLE')               AS generic_title,
          COUNT(DISTINCT p.id) FILTER (WHERE p.quality_status = 'HIDDEN_BROKEN_URL')                  AS broken_url,
          COUNT(DISTINCT p.id) FILTER (WHERE p.quality_status = 'HIDDEN_MISSING_TITLE')               AS missing_title,
          COUNT(DISTINCT p.id) FILTER (WHERE p.quality_status = 'NEEDS_IMAGE')                        AS needs_image
        FROM products p
        JOIN stores s ON p.store_id = s.id
        LEFT JOIN deals d ON d.product_id = p.id
        GROUP BY s.id, s.name, s.slug
        ORDER BY hidden_products DESC, total_products DESC
      `),
      query(`
        SELECT
          p.id AS product_id,
          p.name,
          p.product_url,
          p.image_url,
          p.quality_status,
          p.quality_reason,
          p.last_quality_check_at,
          s.name AS store
        FROM products p
        JOIN stores s ON p.store_id = s.id
        WHERE p.is_public_visible = false OR p.quality_status IS NULL
        ORDER BY p.quality_status NULLS FIRST, s.slug, p.name
        LIMIT 30
      `),
    ]);

    const o = overview.rows[0];
    res.json({
      summary: {
        total_products:       parseInt(o.total_products)       || 0,
        total_deals:          parseInt(o.total_deals)          || 0,
        public_visible_deals: parseInt(o.public_visible_deals) || 0,
        hidden_by_quality:    parseInt(o.hidden_by_quality)    || 0,
        unchecked:            parseInt(o.unchecked)            || 0,
        pass:                 parseInt(o.pass)                 || 0,
      },
      by_status: {
        HIDDEN_GENERIC_TITLE: parseInt(o.generic_title)        || 0,
        HIDDEN_MISSING_TITLE: parseInt(o.missing_title)        || 0,
        HIDDEN_BROKEN_URL:    parseInt(o.broken_url)           || 0,
        NEEDS_IMAGE:          parseInt(o.needs_image)          || 0,
        INCOMPLETE_PRODUCT:   parseInt(o.incomplete_product)   || 0,
        NEEDS_RECOVERY:       parseInt(o.needs_recovery)       || 0,
        MANUAL_REVIEW:        parseInt(o.manual_review)        || 0,
      },
      by_store: byStore.rows,
      top_issues: topIssues.rows,
    });
  } catch (err) {
    logger.error(`[Admin] feed-quality error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/run-image-enrichment
// Processes up to `limit` NEEDS_IMAGE products that have a UPC.
// Calls upcitemdb to fetch image_url, brand, category. Re-classifies each product after update.
// Safe to call repeatedly — skips products with no UPC, respects rate limits via delay.
router.post('/run-image-enrichment', async (req, res) => {
  const limit = Math.min(parseInt(req.body?.limit) || 20, 50);
  const delayMs = parseInt(req.body?.delay_ms) || 1200; // ~50 req/min, stays within upcitemdb trial
  const { lookupUpc } = require('../services/external/upcRecovery');

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  try {
    const candidates = await query(`
      SELECT p.id, p.upc, p.name, p.brand, p.image_url
      FROM products p
      WHERE p.quality_status = 'NEEDS_IMAGE'
        AND p.upc IS NOT NULL
        AND trim(p.upc) != ''
      ORDER BY p.updated_at ASC
      LIMIT $1
    `, [limit]);

    if (!candidates.rows.length) {
      return res.json({ ok: true, processed: 0, enriched: 0, message: 'No eligible products found' });
    }

    let enriched = 0;
    const results = [];

    for (const prod of candidates.rows) {
      const r = { id: prod.id, upc: prod.upc, name: prod.name, outcome: 'no_data' };
      try {
        const data = await lookupUpc(prod.upc);
        if (data?.found && data.image_url) {
          await query(`
            UPDATE products SET
              image_url  = COALESCE(NULLIF(trim($2), ''), image_url),
              brand      = CASE WHEN brand IS NULL AND $3::text IS NOT NULL THEN $3 ELSE brand END,
              quality_status  = 'PASS',
              is_public_visible = TRUE,
              quality_reason  = NULL,
              last_quality_check_at = NOW(),
              updated_at = NOW()
            WHERE id = $1
          `, [prod.id, data.image_url, data.brand || null]);
          r.outcome  = 'enriched';
          r.image    = data.image_url;
          r.source   = data.source;
          enriched++;
        } else {
          r.outcome = data?.found ? 'found_no_image' : 'not_found';
        }
      } catch (err) {
        r.outcome = `error: ${err.message.slice(0, 80)}`;
        logger.warn(`[Admin] enrichment error for product ${prod.id}: ${err.message}`);
      }
      results.push(r);
      await sleep(delayMs);
    }

    logger.info(`[Admin] run-image-enrichment: ${enriched}/${candidates.rows.length} enriched`);
    res.json({ ok: true, processed: candidates.rows.length, enriched, results });
  } catch (err) {
    logger.error(`[Admin] run-image-enrichment error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/run-url-image-enrichment
// Extracts og:image from product URLs for NEEDS_IMAGE products that have no UPC.
// Optional body: { limit: 20, store: "target", delay_ms: 800 }
// Best Buy pages are Akamai-protected and will likely return blocked_or_no_og_image.
router.post('/run-url-image-enrichment', authenticate, requireAdmin, async (req, res) => {
  const limit    = Math.min(parseInt(req.body?.limit) || 20, 50);
  const store    = req.body?.store || null;
  const delayMs  = Math.max(parseInt(req.body?.delay_ms) || 800, 300);
  const https    = require('https');
  const http     = require('http');
  const sleep    = ms => new Promise(r => setTimeout(r, ms));

  function fetchOgImage(url, redirects = 0) {
    if (redirects > 3) return Promise.resolve(null);
    return new Promise((resolve) => {
      const client  = url.startsWith('https') ? https : http;
      const options = {
        headers: {
          'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 12000,
      };
      try {
        const req = client.get(url, options, (response) => {
          const { statusCode, headers } = response;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            response.resume();
            return fetchOgImage(headers.location, redirects + 1).then(resolve);
          }
          if (statusCode !== 200) { response.resume(); return resolve(null); }
          let html = '';
          response.setEncoding('utf8');
          response.on('data', chunk => {
            html += chunk;
            if (html.length > 60000) response.destroy();
          });
          response.on('end', () => {
            const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                   || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
            resolve(m ? m[1] : null);
          });
          response.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch { resolve(null); }
    });
  }

  try {
    const params = [limit];
    const storeFilter = store ? `AND s.slug = $2` : '';
    if (store) params.push(store);

    const candidates = await query(`
      SELECT p.id, p.name, p.product_url, s.slug AS store_slug
      FROM products p
      JOIN stores s ON p.store_id = s.id
      WHERE p.quality_status = 'NEEDS_IMAGE'
        AND p.product_url IS NOT NULL AND trim(p.product_url) != ''
        ${storeFilter}
      ORDER BY p.updated_at ASC
      LIMIT $1
    `, params);

    if (!candidates.rows.length) {
      return res.json({ ok: true, processed: 0, enriched: 0, message: 'No eligible products' });
    }

    let enriched = 0;
    const results = [];

    for (const prod of candidates.rows) {
      const r = { id: prod.id, store: prod.store_slug, name: prod.name.slice(0, 60), outcome: 'no_image' };
      try {
        const imgUrl = await fetchOgImage(prod.product_url);
        if (imgUrl && imgUrl.startsWith('http')) {
          await query(`
            UPDATE products SET
              image_url             = $2,
              quality_status        = 'PASS',
              is_public_visible     = TRUE,
              quality_reason        = NULL,
              last_quality_check_at = NOW(),
              updated_at            = NOW()
            WHERE id = $1
          `, [prod.id, imgUrl]);
          r.outcome = 'enriched';
          r.image   = imgUrl;
          enriched++;
        } else {
          r.outcome = 'blocked_or_no_og_image';
        }
      } catch (err) {
        r.outcome = `error: ${err.message.slice(0, 60)}`;
      }
      results.push(r);
      await sleep(delayMs);
    }

    logger.info(`[Admin] run-url-image-enrichment: ${enriched}/${candidates.rows.length} enriched`);
    res.json({ ok: true, processed: candidates.rows.length, enriched, results });
  } catch (err) {
    logger.error(`[Admin] run-url-image-enrichment error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/push-product-images
// Accepts pre-fetched images and applies them directly to products.
// Use this when the server-side og:image fetch is blocked by the target site's CDN
// (e.g. Target.com blocks datacenter IPs). Run the og:image fetch locally, then push here.
// Body: { updates: [{ product_url: "https://...", image_url: "https://..." }] }
router.post('/push-product-images', authenticate, requireAdmin, async (req, res) => {
  const updates = req.body?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array required' });
  }
  if (updates.length > 100) {
    return res.status(400).json({ error: 'max 100 updates per call' });
  }

  let applied = 0;
  const results = [];

  for (const { product_url, image_url } of updates) {
    if (!product_url || !image_url || !image_url.startsWith('http')) {
      results.push({ product_url, outcome: 'skipped_invalid' });
      continue;
    }
    try {
      const r = await query(`
        UPDATE products SET
          image_url             = $2,
          quality_status        = 'PASS',
          is_public_visible     = TRUE,
          quality_reason        = NULL,
          last_quality_check_at = NOW(),
          updated_at            = NOW()
        WHERE product_url = $1
          AND quality_status = 'NEEDS_IMAGE'
      `, [product_url, image_url]);
      if (r.rowCount > 0) {
        applied++;
        results.push({ product_url: product_url.slice(-40), outcome: 'applied' });
      } else {
        results.push({ product_url: product_url.slice(-40), outcome: 'not_found_or_already_pass' });
      }
    } catch (err) {
      results.push({ product_url: product_url.slice(-40), outcome: `error: ${err.message.slice(0, 60)}` });
    }
  }

  logger.info(`[Admin] push-product-images: ${applied}/${updates.length} applied`);
  res.json({ ok: true, submitted: updates.length, applied, results });
});

// GET /admin/community-reports
// Lists community-submitted product corrections (recovery_source = 'community').
router.get('/community-reports', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const r = await query(`
      SELECT
        upc,
        scans_count,
        high_priority,
        recovery_source,
        recovery_data,
        created_at,
        updated_at
      FROM scanner_unknown_products
      WHERE recovery_source = 'community' AND recovery_found = TRUE
      ORDER BY high_priority DESC, scans_count DESC, updated_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      total:   r.rowCount,
      limit,
      offset,
      reports: r.rows.map(row => ({
        upc:          row.upc,
        scans_count:  row.scans_count,
        high_priority:row.high_priority,
        submitted_by: row.recovery_data?.submitted_by,
        submitted_at: row.recovery_data?.submitted_at,
        name:         row.recovery_data?.title,
        brand:        row.recovery_data?.brand,
        category:     row.recovery_data?.category,
        image_url:    row.recovery_data?.image_url,
        notes:        row.recovery_data?.notes,
        created_at:   row.created_at,
        updated_at:   row.updated_at,
      })),
    });
  } catch (err) {
    logger.error(`[Admin] community-reports error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/community-reports/:upc/approve
// Applies a community-submitted name/brand/category to matching products.
router.post('/community-reports/:upc/approve', async (req, res) => {
  try {
    const { upc } = req.params;

    const reportRes = await query(
      `SELECT recovery_data FROM scanner_unknown_products WHERE upc = $1 AND recovery_source = 'community'`,
      [upc]
    );
    if (!reportRes.rows.length) {
      return res.status(404).json({ error: 'Community report not found for this UPC' });
    }

    const data = reportRes.rows[0].recovery_data || {};
    if (!data.title) return res.status(400).json({ error: 'Report has no product name' });

    // Update matching products — only fill in null fields, never overwrite existing data
    const updateRes = await query(`
      UPDATE products SET
        name       = CASE WHEN (name IS NULL OR trim(name) = '' OR name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$') THEN $2 ELSE name END,
        brand      = CASE WHEN brand IS NULL AND $3::text IS NOT NULL THEN $3 ELSE brand END,
        updated_at = NOW()
      WHERE upc = $1
      RETURNING id, name, brand
    `, [upc, data.title, data.brand || null]);

    logger.info(`[Admin] community report approved: upc=${upc} name="${data.title}" — ${updateRes.rowCount} products updated`);
    res.json({
      ok:               true,
      upc,
      applied_name:     data.title,
      products_updated: updateRes.rowCount,
      products:         updateRes.rows,
    });
  } catch (err) {
    logger.error(`[Admin] community-reports approve error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/quality-dashboard
// Full data quality overview: status breakdown, enrichment queue, community reports.
router.get('/quality-dashboard', async (req, res) => {
  try {
    const [statusBreakdown, enrichmentQueue, communityReports] = await Promise.all([

      // Per-status counts and deal coverage
      query(`
        SELECT
          p.quality_status,
          p.is_public_visible,
          COUNT(DISTINCT p.id)                                      AS products,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_active = TRUE)   AS active_deals
        FROM products p
        LEFT JOIN deals d ON d.product_id = p.id
        GROUP BY p.quality_status, p.is_public_visible
        ORDER BY products DESC
      `),

      // Products needing image enrichment (NEEDS_IMAGE with active deals)
      query(`
        SELECT
          s.name AS store,
          COUNT(DISTINCT p.id) AS needs_image_products,
          COUNT(DISTINCT d.id) AS active_deals
        FROM products p
        JOIN stores s ON p.store_id = s.id
        LEFT JOIN deals d ON d.product_id = p.id AND d.is_active = TRUE
        WHERE p.quality_status = 'NEEDS_IMAGE'
        GROUP BY s.name
        ORDER BY active_deals DESC
      `),

      // Community reports summary
      query(`
        SELECT
          COUNT(*) FILTER (WHERE recovery_source = 'community' AND recovery_found = TRUE) AS pending_review,
          COUNT(*) FILTER (WHERE high_priority = TRUE)                                    AS high_priority,
          MAX(updated_at)                                                                 AS latest_submission
        FROM scanner_unknown_products
      `),
    ]);

    const cr = communityReports.rows[0] || {};
    res.json({
      generated_at:      new Date().toISOString(),
      status_breakdown:  statusBreakdown.rows,
      enrichment_queue:  enrichmentQueue.rows,
      community_reports: {
        pending_review:     parseInt(cr.pending_review) || 0,
        high_priority:      parseInt(cr.high_priority)  || 0,
        latest_submission:  cr.latest_submission,
      },
    });
  } catch (err) {
    logger.error(`[Admin] quality-dashboard error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/data-health — comprehensive health dashboard for all data quality metrics
router.get('/data-health', authenticate, requireAdmin, async (req, res) => {
  try {
    const [
      productStats,
      dealStats,
      brokenLinks,
      noImage,
      noName,
      botBlocked,
      unrecognizedUpc,
      scanStats,
      storeErrors,
    ] = await Promise.all([

      // Active vs total products
      query(`
        SELECT
          COUNT(*)                                           AS total,
          COUNT(*) FILTER (WHERE is_public_visible = true)  AS visible,
          COUNT(*) FILTER (WHERE is_public_visible = false) AS hidden,
          COUNT(*) FILTER (WHERE quality_status IS NULL)    AS unclassified
        FROM products
      `),

      // Deal stats
      query(`
        SELECT
          COUNT(*)                              AS total,
          COUNT(*) FILTER (WHERE is_active = true)  AS active,
          COUNT(*) FILTER (WHERE is_active = false) AS inactive,
          COUNT(*) FILTER (WHERE is_active = true AND estimated_profit < 0) AS negative_profit,
          ROUND(AVG(opportunity_score) FILTER (WHERE is_active = true), 1) AS avg_score
        FROM deals
      `),

      // Broken links by store
      query(`
        SELECT s.name AS store, s.slug, COUNT(p.id) AS count
        FROM products p
        JOIN stores s ON p.store_id = s.id
        WHERE p.quality_status = 'HIDDEN_BROKEN_URL'
        GROUP BY s.name, s.slug
        ORDER BY count DESC
      `),

      // Products without images (NEEDS_IMAGE) that have active deals
      query(`
        SELECT s.name AS store, COUNT(DISTINCT p.id) AS products, COUNT(DISTINCT d.id) AS active_deals
        FROM products p
        JOIN stores s ON p.store_id = s.id
        LEFT JOIN deals d ON d.product_id = p.id AND d.is_active = true
        WHERE p.quality_status = 'NEEDS_IMAGE'
        GROUP BY s.name
        ORDER BY active_deals DESC
        LIMIT 10
      `),

      // Products without proper names
      query(`
        SELECT quality_status, COUNT(*) AS count
        FROM products
        WHERE quality_status IN ('HIDDEN_MISSING_TITLE', 'HIDDEN_GENERIC_TITLE', 'HIDDEN_BOT_BLOCKED')
        GROUP BY quality_status
        ORDER BY count DESC
      `),

      // Bot-blocked pages saved as names
      query(`
        SELECT COUNT(*) AS count FROM products WHERE quality_status = 'HIDDEN_BOT_BLOCKED'
      `),

      // UPCs scanned but not recognized
      query(`
        SELECT
          COUNT(*)                                          AS total_unknown,
          COUNT(*) FILTER (WHERE recovery_found = true)    AS recovered,
          COUNT(*) FILTER (WHERE recovery_found = false AND recovery_attempted = true) AS unrecoverable,
          COUNT(*) FILTER (WHERE recovery_attempted = false) AS not_attempted,
          COUNT(*) FILTER (WHERE high_priority = true)     AS high_priority
        FROM scanner_unknown_products
      `),

      // Scan success/failure last 7 days
      query(`
        SELECT
          COUNT(*)                                              AS total,
          COUNT(*) FILTER (WHERE status = 'success')           AS success,
          COUNT(*) FILTER (WHERE status = 'partial')           AS partial,
          COUNT(*) FILTER (WHERE status = 'error')             AS error,
          COUNT(*) FILTER (WHERE status = 'running')           AS running,
          SUM(products_scanned)                                AS total_scanned,
          SUM(deals_found)                                     AS total_deals,
          ROUND(AVG(duration_seconds) FILTER (WHERE status IN ('success','partial','error')), 0) AS avg_duration_s
        FROM scan_logs
        WHERE started_at > NOW() - INTERVAL '7 days'
      `),

      // Per-store error summary from scan_logs (last 24h error_details)
      query(`
        SELECT error_details
        FROM scan_logs
        WHERE started_at > NOW() - INTERVAL '24 hours'
          AND error_details IS NOT NULL
          AND error_details != '{}'
          AND error_details != 'null'
        ORDER BY started_at DESC
        LIMIT 10
      `),
    ]);

    // Aggregate per-store errors from recent scan error_details
    const storeErrorMap = {};
    for (const row of storeErrors.rows) {
      let ed = row.error_details;
      if (typeof ed === 'string') { try { ed = JSON.parse(ed); } catch { continue; } }
      if (!ed || typeof ed !== 'object') continue;
      for (const [store, info] of Object.entries(ed)) {
        if (!storeErrorMap[store]) storeErrorMap[store] = { errors: 0, scanned: 0, cycles: 0 };
        storeErrorMap[store].errors  += info.errors || 0;
        storeErrorMap[store].scanned += info.products_scanned || 0;
        storeErrorMap[store].cycles  += 1;
      }
    }

    const ps = productStats.rows[0];
    const ds = dealStats.rows[0];
    const sc = scanStats.rows[0];
    const uu = unrecognizedUpc.rows[0];

    res.json({
      generated_at: new Date().toISOString(),
      products: {
        total:        parseInt(ps.total) || 0,
        visible:      parseInt(ps.visible) || 0,
        hidden:       parseInt(ps.hidden) || 0,
        unclassified: parseInt(ps.unclassified) || 0,
      },
      deals: {
        total:          parseInt(ds.total) || 0,
        active:         parseInt(ds.active) || 0,
        inactive:       parseInt(ds.inactive) || 0,
        negative_profit: parseInt(ds.negative_profit) || 0,
        avg_score:      parseFloat(ds.avg_score) || 0,
      },
      broken_links: {
        total: brokenLinks.rows.reduce((s, r) => s + parseInt(r.count), 0),
        by_store: brokenLinks.rows.map(r => ({ store: r.store, slug: r.slug, count: parseInt(r.count) })),
      },
      missing_images: {
        total: noImage.rows.reduce((s, r) => s + parseInt(r.products), 0),
        by_store: noImage.rows.map(r => ({ store: r.store, products: parseInt(r.products), active_deals: parseInt(r.active_deals) })),
      },
      bad_names: {
        total: noName.rows.reduce((s, r) => s + parseInt(r.count), 0),
        bot_blocked: parseInt(botBlocked.rows[0]?.count) || 0,
        by_type: noName.rows.map(r => ({ type: r.quality_status, count: parseInt(r.count) })),
      },
      upc_recognition: {
        total_scanned: parseInt(uu.total_unknown) || 0,
        recovered:     parseInt(uu.recovered) || 0,
        unrecoverable: parseInt(uu.unrecoverable) || 0,
        not_attempted: parseInt(uu.not_attempted) || 0,
        high_priority: parseInt(uu.high_priority) || 0,
        recovery_rate_pct: uu.total_unknown > 0
          ? Math.round(parseInt(uu.recovered) / parseInt(uu.total_unknown) * 100)
          : null,
      },
      scan_health: {
        period: '7 days',
        total:       parseInt(sc.total) || 0,
        success:     parseInt(sc.success) || 0,
        partial:     parseInt(sc.partial) || 0,
        error:       parseInt(sc.error) || 0,
        running:     parseInt(sc.running) || 0,
        success_rate_pct: sc.total > 0
          ? Math.round((parseInt(sc.success) + parseInt(sc.partial)) / parseInt(sc.total) * 100)
          : null,
        total_scanned:  parseInt(sc.total_scanned) || 0,
        total_deals:    parseInt(sc.total_deals) || 0,
        avg_duration_s: parseInt(sc.avg_duration_s) || 0,
      },
      store_errors_24h: storeErrorMap,
    });
  } catch (err) {
    logger.error(`[Admin] data-health error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/beta-metrics ──────────────────────────────────────────────
router.get('/beta-metrics', authenticate, requireAdmin, async (req, res) => {
  try {
    const [
      usersRes, activeRes, regPerDayRes,
      scansRes, dealsRes, approvedRes,
      upcRes, referralRes, aiExcludeCheck,
    ] = await Promise.all([
      // Total human users (non-AI)
      query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS new_7d,
             COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours') AS new_24h
             FROM users WHERE is_ai_leader IS NOT TRUE AND is_active=true`),
      // Active users = logged in / created token last 7 days (proxy: recent scan or deal or post)
      query(`
        SELECT COUNT(DISTINCT user_id) AS active_7d,
               COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours') AS active_24h
        FROM (
          SELECT user_id, created_at FROM collaborator_points_log
          UNION ALL
          SELECT user_id, created_at FROM deal_posts WHERE is_ai_post IS NOT TRUE
          UNION ALL
          SELECT u.id AS user_id, u.created_at FROM users u
            WHERE u.created_at >= NOW()-INTERVAL '7 days' AND u.is_ai_leader IS NOT TRUE
        ) activity
        WHERE created_at >= NOW()-INTERVAL '7 days'
      `),
      // Registrations per day last 7 days
      query(`
        SELECT DATE(created_at) AS day, COUNT(*) AS count
        FROM users WHERE is_ai_leader IS NOT TRUE AND created_at >= NOW()-INTERVAL '7 days'
        GROUP BY DATE(created_at) ORDER BY day ASC
      `),
      // Scans (scanner logs / points_log action=scan)
      query(`
        SELECT COUNT(*) AS total_scans,
               COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours') AS scans_24h,
               COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS scans_7d
        FROM collaborator_points_log WHERE action = 'scan'
      `),
      // Deal posts (human only)
      query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours') AS today,
               COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS this_week
        FROM deal_posts WHERE is_ai_post IS NOT TRUE AND status != 'hidden'
      `),
      // Submitted deals approved/verified
      query(`
        SELECT COUNT(*) AS total_submitted,
               COUNT(*) FILTER (WHERE status IN ('verified','approved','official')) AS approved,
               COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS submitted_7d,
               ROUND(
                 COUNT(*) FILTER (WHERE status IN ('verified','approved','official'))::numeric /
                 NULLIF(COUNT(*), 0) * 100, 1
               ) AS approval_rate_pct
        FROM submitted_deals
      `),
      // UPC recognition rate
      query(`
        SELECT COUNT(*) AS total_scanned,
               COUNT(*) FILTER (WHERE quality_status NOT IN ('HIDDEN_NO_UPC','HIDDEN_UNCLASSIFIED') OR quality_status IS NULL) AS recognized,
               ROUND(
                 COUNT(*) FILTER (WHERE quality_status NOT IN ('HIDDEN_NO_UPC','HIDDEN_UNCLASSIFIED') OR quality_status IS NULL)::numeric /
                 NULLIF(COUNT(*), 0) * 100, 1
               ) AS recognition_rate_pct
        FROM products WHERE upc IS NOT NULL
      `),
      // Referral stats
      query(`
        SELECT COUNT(*) AS total_referrals,
               COUNT(*) FILTER (WHERE converted_to_paid) AS converted,
               COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS new_7d
        FROM referral_events
      `),
      // AI leader exclusion check — confirm none in hunter queries
      query(`SELECT COUNT(*) AS ai_with_collab_profile
             FROM collaborator_profiles cp JOIN users u ON cp.user_id=u.id WHERE u.is_ai_leader=true`),
    ]);

    const u  = usersRes.rows[0];
    const a  = activeRes.rows[0];
    const sc = scansRes.rows[0];
    const dp = dealsRes.rows[0];
    const sd = approvedRes.rows[0];
    const ur = upcRes.rows[0];
    const rf = referralRes.rows[0];

    res.json({
      users: {
        total_human:     parseInt(u.total) || 0,
        new_last_24h:    parseInt(u.new_24h) || 0,
        new_last_7d:     parseInt(u.new_7d) || 0,
        active_last_24h: parseInt(a.active_24h) || 0,
        active_last_7d:  parseInt(a.active_7d) || 0,
        registrations_per_day: regPerDayRes.rows.map(r => ({ day: r.day, count: parseInt(r.count) })),
      },
      scans: {
        total:    parseInt(sc.total_scans) || 0,
        last_24h: parseInt(sc.scans_24h) || 0,
        last_7d:  parseInt(sc.scans_7d) || 0,
      },
      deal_posts: {
        total:     parseInt(dp.total) || 0,
        today:     parseInt(dp.today) || 0,
        this_week: parseInt(dp.this_week) || 0,
      },
      submitted_deals: {
        total:            parseInt(sd.total_submitted) || 0,
        approved:         parseInt(sd.approved) || 0,
        submitted_7d:     parseInt(sd.submitted_7d) || 0,
        approval_rate_pct: parseFloat(sd.approval_rate_pct) || 0,
      },
      upc_recognition: {
        total_products:      parseInt(ur.total_scanned) || 0,
        recognized:          parseInt(ur.recognized) || 0,
        recognition_rate_pct: parseFloat(ur.recognition_rate_pct) || 0,
      },
      referrals: {
        total:     parseInt(rf.total_referrals) || 0,
        converted: parseInt(rf.converted) || 0,
        new_7d:    parseInt(rf.new_7d) || 0,
      },
      ai_integrity: {
        ai_leaders_in_collab_profiles: parseInt(aiExcludeCheck.rows[0].ai_with_collab_profile) || 0,
        leaderboard_clean: parseInt(aiExcludeCheck.rows[0].ai_with_collab_profile) === 0,
      },
    });
  } catch (err) {
    logger.error(`[Admin] beta-metrics: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/ai-leaders ─────────────────────────────────────────────────
router.get('/ai-leaders', authenticate, requireAdmin, async (req, res) => {
  try {
    const [leadersRes, settingsRes, todayComments, todayPosts] = await Promise.all([
      query(`
        SELECT u.id, u.name, u.email, u.ai_role, u.ai_persona, u.ai_specialty,
               u.ai_disclosure_label, u.avatar_url, u.is_active,
               (SELECT COUNT(*) FROM deal_posts WHERE user_id=u.id AND is_ai_post=true)         AS post_count,
               (SELECT COUNT(*) FROM deal_post_comments WHERE ai_leader_id=u.id AND is_ai_comment=true) AS comment_count,
               (SELECT COUNT(*) FROM deal_posts WHERE user_id=u.id AND is_ai_post=true AND created_at>=CURRENT_DATE) AS posts_today,
               (SELECT COUNT(*) FROM deal_post_comments WHERE ai_leader_id=u.id AND is_ai_comment=true AND created_at>=CURRENT_DATE) AS comments_today
        FROM users u WHERE is_ai_leader=true ORDER BY u.name
      `),
      query('SELECT key, value FROM ai_leader_settings ORDER BY key').catch(() => ({ rows: [] })),
      query(`SELECT COUNT(*) FROM deal_post_comments WHERE is_ai_comment=true AND created_at>=CURRENT_DATE`),
      query(`SELECT COUNT(*) FROM deal_posts WHERE is_ai_post=true AND created_at>=CURRENT_DATE`),
    ]);

    const settings = {};
    for (const row of settingsRes.rows) settings[row.key] = row.value;

    res.json({
      leaders: leadersRes.rows,
      settings,
      today: {
        comments: parseInt(todayComments.rows[0].count),
        posts:    parseInt(todayPosts.rows[0].count),
      },
    });
  } catch (err) {
    logger.error(`[Admin] ai-leaders: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/ai-leaders/settings ──────────────────────────────────────
router.post('/ai-leaders/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const ALLOWED = [
      'AI_LEADERS_ENABLED', 'AI_AUTO_POSTS_ENABLED', 'AI_AUTO_COMMENTS_ENABLED',
      'AI_MAX_COMMENTS_PER_DAY', 'AI_MAX_POSTS_PER_DAY',
      'AI_DAILY_TIPS_ENABLED', 'AI_RECOGNITION_ENABLED', 'AI_WELCOME_ENABLED',
      'AI_TOP_HUNTERS_ENABLED', 'AI_MISSION_OF_DAY_ENABLED', 'AI_FAQ_ENABLED',
    ];
    const updates = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (!ALLOWED.includes(key)) continue;
      await query(`
        INSERT INTO ai_leader_settings (key, value, updated_at)
        VALUES ($1,$2,NOW())
        ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
      `, [key, String(value)]);
      updates.push(key);
    }
    res.json({ updated: updates });
  } catch (err) {
    logger.error(`[Admin] ai-leaders/settings POST: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/ai-leaders/:id/toggle ────────────────────────────────────
router.post('/ai-leaders/:id/toggle', authenticate, requireAdmin, async (req, res) => {
  try {
    const r = await query(
      `UPDATE users SET is_active=NOT is_active, updated_at=NOW()
       WHERE id=$1 AND is_ai_leader=true RETURNING id, name, is_active`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'AI leader not found' });
    res.json({ leader: r.rows[0] });
  } catch (err) {
    logger.error(`[Admin] ai-leaders toggle: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/teams-health ──────────────────────────────────────────────
router.get('/teams-health', authenticate, requireAdmin, async (req, res) => {
  try {
    const teams = await query(`
      SELECT t.id, t.name, t.slug, t.team_type, t.is_active,
             t.points, t.approved_deals_count, t.created_at,
             COUNT(DISTINCT tm.user_id) FILTER (WHERE tm.is_active = true AND tm.role != 'ai_coach') AS member_count,
             COUNT(DISTINCT m.id) FILTER (WHERE m.is_active = true) AS active_missions,
             COUNT(DISTINCT ta.id) FILTER (WHERE ta.created_at > NOW() - INTERVAL '7 days') AS activity_7d,
             u_coach.name AS coach_name
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN team_missions m ON m.team_id = t.id
      LEFT JOIN team_activity ta ON ta.team_id = t.id
      LEFT JOIN users u_coach ON t.ai_coach_id = u_coach.id
      GROUP BY t.id, u_coach.name
      ORDER BY t.points DESC
    `);

    const totals = await query(`
      SELECT
        COUNT(DISTINCT t.id) AS total_teams,
        COUNT(DISTINCT tm.user_id) FILTER (WHERE tm.is_active = true AND tm.role != 'ai_coach') AS total_members,
        COUNT(DISTINCT m.id) FILTER (WHERE m.is_active = true) AS total_missions,
        COUNT(DISTINCT ta.id) FILTER (WHERE ta.created_at > NOW() - INTERVAL '24 hours') AS activity_24h
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN team_missions m ON m.team_id = t.id
      LEFT JOIN team_activity ta ON ta.team_id = t.id
    `);

    res.json({ teams: teams.rows, totals: totals.rows[0] });
  } catch (err) {
    logger.error(`[Admin] teams-health: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/ai-leaders/recent-posts ───────────────────────────────────
router.get('/ai-leaders/recent-posts', authenticate, requireAdmin, async (req, res) => {
  try {
    const r = await query(`
      SELECT dp.id, dp.title, dp.created_at, u.name AS leader_name, u.ai_disclosure_label
      FROM deal_posts dp
      JOIN users u ON dp.user_id=u.id
      WHERE dp.is_ai_post=true
      ORDER BY dp.created_at DESC
      LIMIT 20
    `);
    res.json({ posts: r.rows });
  } catch (err) {
    logger.error(`[Admin] ai-leaders recent-posts: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

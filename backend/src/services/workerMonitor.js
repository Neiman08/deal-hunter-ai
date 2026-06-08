/**
 * Worker Monitor — passive observer of the Background Worker
 *
 * Runs inside the web service (NOT the worker). Polls the DB every 5 min to
 * detect worker activity by inspecting products/prices/deals creation timestamps.
 * Does NOT modify run-discovery-live.js or the worker in any way.
 *
 * State machine:
 *   IDLE      → no new products detected since last completed cycle
 *   ACTIVE    → products/prices being added right now
 *   COMPLETE  → no new products for IDLE_THRESHOLD_MS, cycle is over → write worker_runs row
 */

const { query } = require('../config/database');
const logger    = require('../utils/logger');

const POLL_INTERVAL_MS  = 5 * 60 * 1000;   // poll every 5 min
const IDLE_THRESHOLD_MS = 35 * 60 * 1000;  // 35 min of no activity = cycle ended

let lastCheckAt        = new Date();
let lastActivityAt     = null;
let cycleStartAt       = null;
let cycleBaseCounts    = null;   // { products, prices, deals } at cycle start
let inCycle            = false;
let monitorInterval    = null;

// ─── Provision table if missing ───────────────────────────────────────────────
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS worker_runs (
      id               SERIAL PRIMARY KEY,
      cycle_num        INTEGER,
      period_start     TIMESTAMPTZ NOT NULL,
      period_end       TIMESTAMPTZ,
      duration_seconds INTEGER,
      products_added   INTEGER DEFAULT 0,
      prices_added     INTEGER DEFAULT 0,
      deals_added      INTEGER DEFAULT 0,
      active_deals_end INTEGER DEFAULT 0,
      status           VARCHAR(20) DEFAULT 'complete',
      store_summary    JSONB DEFAULT '{}',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_worker_runs_start ON worker_runs (period_start DESC)`);
}

// ─── Read current DB totals ───────────────────────────────────────────────────
async function getDbCounts() {
  const [p, pr, d, da] = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM products'),
    query('SELECT COUNT(*)::int AS n FROM prices'),
    query('SELECT COUNT(*)::int AS n FROM deals WHERE detected_at IS NOT NULL'),
    query('SELECT COUNT(*)::int AS n FROM deals WHERE is_active = true'),
  ]);
  return {
    products:     p.rows[0].n,
    prices:       pr.rows[0].n,
    deals:        d.rows[0].n,
    active_deals: da.rows[0].n,
  };
}

// ─── Count rows created since a timestamp ─────────────────────────────────────
async function countSince(since) {
  const [p, pr, d] = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM products WHERE created_at > $1', [since]),
    query('SELECT COUNT(*)::int AS n FROM prices WHERE recorded_at > $1', [since]),
    query('SELECT COUNT(*)::int AS n FROM deals WHERE detected_at > $1', [since]),
  ]);
  return { products: p.rows[0].n, prices: pr.rows[0].n, deals: d.rows[0].n };
}

// ─── Per-store breakdown for the completed cycle ───────────────────────────────
async function storeBreakdownSince(since) {
  const r = await query(`
    SELECT
      s.slug,
      COUNT(DISTINCT p.id)                                  AS products_added,
      COUNT(d.id) FILTER (WHERE d.is_active)                AS active_deals,
      COUNT(d.id)                                           AS total_deals,
      MAX(p.created_at)                                     AS last_seen
    FROM stores s
    LEFT JOIN products p ON p.store_id = s.id AND p.created_at > $1
    LEFT JOIN deals   d ON d.store_id  = s.id AND d.detected_at > $1
    GROUP BY s.slug, s.name
    ORDER BY products_added DESC
  `, [since]);
  const out = {};
  for (const row of r.rows) {
    if (row.products_added > 0 || row.active_deals > 0) {
      out[row.slug] = {
        products_added: row.products_added,
        active_deals:   row.active_deals,
        total_deals:    row.total_deals,
        last_seen:      row.last_seen,
      };
    }
  }
  return out;
}

// ─── Write completed cycle to worker_runs ─────────────────────────────────────
async function writeCycleRecord(cycleNum, start, end, baseCounts) {
  const totals    = await getDbCounts();
  const summary   = await storeBreakdownSince(start).catch(() => ({}));
  const duration  = Math.round((end - start) / 1000);

  await query(`
    INSERT INTO worker_runs
      (cycle_num, period_start, period_end, duration_seconds,
       products_added, prices_added, deals_added, active_deals_end,
       status, store_summary)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'complete',$9)
  `, [
    cycleNum, start, end, duration,
    totals.products  - baseCounts.products,
    totals.prices    - baseCounts.prices,
    totals.deals     - baseCounts.deals,
    totals.active_deals,
    JSON.stringify(summary),
  ]);

  logger.info(`[WorkerMonitor] Cycle #${cycleNum} recorded: +${totals.products - baseCounts.products} products, +${totals.deals - baseCounts.deals} deals`);
}

// ─── Poll tick ────────────────────────────────────────────────────────────────
let cycleNum = 0;

async function tick() {
  const now = new Date();
  try {
    const delta = await countSince(lastCheckAt);

    if (delta.products > 0 || delta.prices > 0) {
      lastActivityAt = now;

      if (!inCycle) {
        // New cycle started
        inCycle       = true;
        cycleStartAt  = now;
        cycleBaseCounts = await getDbCounts();
        // Subtract what was added since lastCheckAt (already in delta)
        cycleBaseCounts.products -= delta.products;
        cycleBaseCounts.prices   -= delta.prices;
        cycleBaseCounts.deals    -= delta.deals;
        logger.info(`[WorkerMonitor] Cycle started — products before: ${cycleBaseCounts.products}`);
      }
    }

    if (inCycle && lastActivityAt) {
      const idleMs = now - lastActivityAt;
      if (idleMs >= IDLE_THRESHOLD_MS) {
        // Cycle ended
        cycleNum++;
        await writeCycleRecord(cycleNum, cycleStartAt, lastActivityAt, cycleBaseCounts);
        inCycle         = false;
        cycleStartAt    = null;
        cycleBaseCounts = null;
      }
    }
  } catch (err) {
    logger.warn(`[WorkerMonitor] Tick error: ${err.message}`);
  }
  lastCheckAt = now;
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function getStatus() {
  const [lastRun, totals] = await Promise.all([
    query(`SELECT * FROM worker_runs ORDER BY period_start DESC LIMIT 1`).then(r => r.rows[0] || null),
    getDbCounts(),
  ]);

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [today] = await Promise.all([
    countSince(todayStart),
  ]);

  // Worker is "alive" if any products were added in the last 35 min
  const recentActivity = await countSince(new Date(Date.now() - IDLE_THRESHOLD_MS));
  const workerAlive = recentActivity.products > 0 || recentActivity.prices > 0;

  return {
    worker_alive:      workerAlive,
    in_cycle:          inCycle,
    cycle_started_at:  cycleStartAt,
    last_activity_at:  lastActivityAt,
    last_run:          lastRun,
    db_totals:         totals,
    added_today:       today,
    last_30_min:       recentActivity,
  };
}

async function getStoreSummary() {
  const r = await query(`
    SELECT
      s.slug,
      s.name,
      COUNT(DISTINCT p.id)                                          AS total_products,
      COUNT(d.id) FILTER (WHERE d.is_active)                        AS active_deals,
      COUNT(d.id)                                                   AS total_deals,
      COUNT(d.id) FILTER (WHERE d.is_active = false AND d.id IS NOT NULL) AS inactive_deals,
      ROUND(AVG(d.discount_percent) FILTER (WHERE d.is_active))    AS avg_discount,
      ROUND(AVG(d.opportunity_score) FILTER (WHERE d.is_active))   AS avg_score,
      MAX(p.created_at)                                             AS last_product_added
    FROM stores s
    LEFT JOIN products p ON p.store_id = s.id
    LEFT JOIN deals   d ON d.product_id = p.id
    GROUP BY s.id, s.slug, s.name
    ORDER BY total_products DESC
  `);
  return r.rows;
}

async function getRecentRuns(limit = 10) {
  const r = await query(
    `SELECT * FROM worker_runs ORDER BY period_start DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// ─── Start / stop ─────────────────────────────────────────────────────────────
async function startWorkerMonitor() {
  try {
    await ensureTable();
    logger.info('[WorkerMonitor] Started — polling every 5 min');
    // Initial tick after 30s (let DB settle after startup)
    setTimeout(() => tick().catch(() => {}), 30000);
    monitorInterval = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
  } catch (err) {
    logger.warn(`[WorkerMonitor] Could not start: ${err.message}`);
  }
}

function stopWorkerMonitor() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
}

module.exports = { startWorkerMonitor, stopWorkerMonitor, getStatus, getStoreSummary, getRecentRuns };

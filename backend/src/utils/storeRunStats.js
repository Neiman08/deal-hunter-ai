/**
 * Writes per-run stats to worker_store_runs table.
 * Called at end of each discovery engine run.
 *
 * Table is auto-created on first write — no migration needed.
 */

const { query } = require('../config/database');
const { execSync } = require('child_process');

function getCommitSha() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return null; }
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS worker_store_runs (
    id                   SERIAL PRIMARY KEY,
    store_slug           VARCHAR(50) NOT NULL,
    started_at           TIMESTAMPTZ NOT NULL,
    completed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pages_visited        INTEGER DEFAULT 0,
    urls_discovered      INTEGER DEFAULT 0,
    urls_new             INTEGER DEFAULT 0,
    saved                INTEGER DEFAULT 0,
    errors               INTEGER DEFAULT 0,
    blocked              BOOLEAN DEFAULT false,
    block_type           VARCHAR(80),
    last_error           TEXT,
    proxy_used           VARCHAR(30),
    screenshot_path      TEXT,
    duration_seconds     NUMERIC(8,1),
    commit_sha           VARCHAR(40),
    proxy_requests_est   INTEGER DEFAULT 0,
    cost_efficiency      NUMERIC(6,3),
    reason_for_stop      VARCHAR(200)
  )
`;

const ADD_COLUMNS = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='worker_store_runs' AND column_name='block_type') THEN
      ALTER TABLE worker_store_runs ADD COLUMN block_type VARCHAR(80);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='worker_store_runs' AND column_name='proxy_used') THEN
      ALTER TABLE worker_store_runs ADD COLUMN proxy_used VARCHAR(30);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='worker_store_runs' AND column_name='screenshot_path') THEN
      ALTER TABLE worker_store_runs ADD COLUMN screenshot_path TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='worker_store_runs' AND column_name='proxy_requests_est') THEN
      ALTER TABLE worker_store_runs ADD COLUMN proxy_requests_est INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='worker_store_runs' AND column_name='cost_efficiency') THEN
      ALTER TABLE worker_store_runs ADD COLUMN cost_efficiency NUMERIC(6,3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='worker_store_runs' AND column_name='reason_for_stop') THEN
      ALTER TABLE worker_store_runs ADD COLUMN reason_for_stop VARCHAR(200);
    END IF;
  END $$;
`;

const UPSERT = `
  INSERT INTO worker_store_runs
    (store_slug, started_at, completed_at, pages_visited, urls_discovered,
     urls_new, saved, errors, blocked, block_type, last_error, proxy_used,
     screenshot_path, duration_seconds, commit_sha,
     proxy_requests_est, cost_efficiency, reason_for_stop)
  VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
`;

async function writeStoreRun(storeSlug, startedAt, stats) {
  try {
    await query(CREATE_TABLE);
    await query(ADD_COLUMNS);
    const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
    const proxyEst = stats.proxy_requests_est || 0;
    const saved    = stats.saved || 0;
    const efficiency = proxyEst > 0 ? parseFloat((saved / proxyEst).toFixed(3)) : null;
    await query(UPSERT, [
      storeSlug,
      new Date(startedAt).toISOString(),
      stats.pages_visited    || 0,
      stats.urls_discovered  || 0,
      stats.urls_new         || 0,
      saved,
      stats.errors           || 0,
      stats.blocked          || false,
      stats.blockType        || null,
      stats.last_error       || null,
      stats.proxy_used       || null,
      stats.screenshot_path  || null,
      parseFloat(dur),
      getCommitSha(),
      proxyEst,
      efficiency,
      stats.reason_for_stop  || null,
    ]);
  } catch (err) {
    require('./logger').warn(`[StoreRunStats:${storeSlug}] Failed to write: ${err.message}`);
  }
}

module.exports = { writeStoreRun };

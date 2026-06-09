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
    id              SERIAL PRIMARY KEY,
    store_slug      VARCHAR(50) NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pages_visited   INTEGER DEFAULT 0,
    urls_discovered INTEGER DEFAULT 0,
    urls_new        INTEGER DEFAULT 0,
    saved           INTEGER DEFAULT 0,
    errors          INTEGER DEFAULT 0,
    blocked         BOOLEAN DEFAULT false,
    last_error      TEXT,
    duration_seconds NUMERIC(8,1),
    commit_sha      VARCHAR(40)
  )
`;

const UPSERT = `
  INSERT INTO worker_store_runs
    (store_slug, started_at, completed_at, pages_visited, urls_discovered,
     urls_new, saved, errors, blocked, last_error, duration_seconds, commit_sha)
  VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11)
`;

async function writeStoreRun(storeSlug, startedAt, stats) {
  try {
    await query(CREATE_TABLE);
    const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
    await query(UPSERT, [
      storeSlug,
      new Date(startedAt).toISOString(),
      stats.pages_visited || 0,
      stats.urls_discovered || 0,
      stats.urls_new || 0,
      stats.saved || 0,
      stats.errors || 0,
      stats.blocked || false,
      stats.last_error || null,
      parseFloat(dur),
      getCommitSha(),
    ]);
  } catch (err) {
    // Non-fatal — logging only
    require('./logger').warn(`[StoreRunStats:${storeSlug}] Failed to write: ${err.message}`);
  }
}

module.exports = { writeStoreRun };

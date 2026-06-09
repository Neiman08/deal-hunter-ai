/**
 * Discovery Job Queue
 *
 * Web service enqueues jobs. Worker polls and executes them.
 * Prevents heavy Playwright/HTTP scraping from running on the web service.
 */

const { query } = require('../config/database');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS discovery_jobs (
    id            SERIAL PRIMARY KEY,
    store_slug    VARCHAR(50) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_by  VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    result_json   JSONB,
    error         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status     ON discovery_jobs (status, created_at);
  CREATE INDEX IF NOT EXISTS idx_discovery_jobs_store_slug ON discovery_jobs (store_slug, created_at DESC);
`;

async function ensureTable() {
  await query(CREATE_TABLE);
}

async function enqueueJob(storeSlug, requestedBy) {
  await ensureTable();
  // Deduplicate: don't add if a pending or running job already exists for this store
  const existing = await query(
    `SELECT id, status FROM discovery_jobs WHERE store_slug = $1 AND status IN ('pending','running') LIMIT 1`,
    [storeSlug]
  );
  if (existing.rows.length) return { job: existing.rows[0], queued: false, reason: 'already_queued' };

  const r = await query(
    `INSERT INTO discovery_jobs (store_slug, requested_by, status, created_at)
     VALUES ($1, $2, 'pending', NOW()) RETURNING *`,
    [storeSlug, requestedBy || null]
  );
  return { job: r.rows[0], queued: true };
}

async function claimNextPendingJob() {
  await ensureTable();
  // Atomic claim with SKIP LOCKED to avoid two workers picking the same job
  const r = await query(`
    UPDATE discovery_jobs SET status = 'running', started_at = NOW()
    WHERE id = (
      SELECT id FROM discovery_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return r.rows[0] || null;
}

async function markCompleted(jobId, resultJson) {
  await query(
    `UPDATE discovery_jobs SET status = 'completed', completed_at = NOW(), result_json = $1 WHERE id = $2`,
    [JSON.stringify(resultJson || {}), jobId]
  );
}

async function markFailed(jobId, errorMessage) {
  await query(
    `UPDATE discovery_jobs SET status = 'failed', completed_at = NOW(), error = $1 WHERE id = $2`,
    [errorMessage || 'unknown error', jobId]
  );
}

async function getLatestJob(storeSlug) {
  await ensureTable();
  const r = await query(
    `SELECT * FROM discovery_jobs
     WHERE ($1::text IS NULL OR store_slug = $1)
     ORDER BY created_at DESC LIMIT 1`,
    [storeSlug || null]
  );
  return r.rows[0] || null;
}

async function listJobs({ limit = 20, storeSlug } = {}) {
  await ensureTable();
  const r = await query(
    `SELECT * FROM discovery_jobs
     WHERE ($1::text IS NULL OR store_slug = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [storeSlug || null, limit]
  );
  return r.rows;
}

module.exports = { ensureTable, enqueueJob, claimNextPendingJob, markCompleted, markFailed, getLatestJob, listJobs };

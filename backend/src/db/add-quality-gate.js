/**
 * Migration: add quality gate columns to products table.
 * Step 1 (this file): schema only — always succeeds.
 * Step 2 (quality-classify.js): data backfill — runs separately.
 */
const { query } = require('../config/database');

async function migrate() {
  // Add columns one at a time — most defensive approach
  for (const stmt of [
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_status    VARCHAR(30) DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_reason    TEXT        DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS is_public_visible BOOLEAN     DEFAULT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_products_quality_hidden  ON products(is_public_visible) WHERE is_public_visible = false`,
    `CREATE INDEX IF NOT EXISTS idx_products_quality_status  ON products(quality_status)    WHERE quality_status IS NOT NULL`,
  ]) {
    await query(stmt);
  }
  console.log('[add-quality-gate] columns + indexes ready');
}

migrate()
  .catch(err => { console.error('[add-quality-gate] ERROR:', err.message); process.exit(1); })
  .then(() => process.exit(0));

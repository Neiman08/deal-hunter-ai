/**
 * Migration: add quality gate columns to products table.
 *
 * quality_status:     PASS | MISSING_TITLE | PLACEHOLDER_TITLE | BROKEN_URL |
 *                     MISSING_IMAGE | INVALID_PRICE | SUSPICIOUS_PRICE | INCOMPLETE_PRODUCT
 * quality_reason:     human-readable explanation of the status
 * is_public_visible:  NULL = unchecked (shows in feed), true = PASS, false = hidden
 *
 * NULL defaults to visible so all pre-existing products keep showing until the backfill runs.
 */
require('dotenv').config({ path: '../../.env' });
const { pool } = require('../config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS quality_status      VARCHAR(30)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS quality_reason      TEXT         DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS is_public_visible   BOOLEAN      DEFAULT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_quality_hidden
        ON products(is_public_visible)
        WHERE is_public_visible = false
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_quality_status
        ON products(quality_status)
        WHERE quality_status IS NOT NULL
    `);

    await client.query('COMMIT');
    console.log('[add-quality-gate] migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message.includes('already exists') || err.message.includes('column') && err.message.includes('already exists')) {
      console.log('[add-quality-gate] columns already exist, skipping');
    } else {
      console.error('[add-quality-gate] ERROR:', err.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run();

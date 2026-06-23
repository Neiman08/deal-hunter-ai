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
    console.log('[add-quality-gate] schema migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message.includes('already exists') || err.message.includes('column') && err.message.includes('already exists')) {
      console.log('[add-quality-gate] columns already exist, skipping schema step');
    } else {
      console.error('[add-quality-gate] ERROR:', err.message);
      process.exit(1);
    }
  } finally {
    client.release();
  }

  // Run initial quality classification — safe to re-run (idempotent UPDATE).
  // Runs outside the schema transaction so a partial earlier run doesn't block this.
  const client2 = await pool.connect();
  try {
    const result = await client2.query(`
      UPDATE products p SET
        quality_status = CASE
          WHEN trim(COALESCE(p.name, '')) = '' OR length(trim(COALESCE(p.name, ''))) < 5
            THEN 'MISSING_TITLE'
          WHEN trim(p.name) ~* '^gamestop product\\s+\\d+$'
            THEN 'PLACEHOLDER_TITLE'
          WHEN trim(p.name) ~* '^product\\s+\\d+$'
            THEN 'PLACEHOLDER_TITLE'
          WHEN trim(p.name) ~ '^\\d{5,}$'
            THEN 'PLACEHOLDER_TITLE'
          WHEN (p.product_url LIKE '%macys.com%')
               AND (p.product_url NOT LIKE '%?ID=%')
               AND (p.product_url NOT LIKE '%/ID/%')
            THEN 'BROKEN_URL'
          WHEN p.product_url IS NULL OR trim(p.product_url) = ''
            THEN 'INCOMPLETE_PRODUCT'
          ELSE 'PASS'
        END,
        is_public_visible = CASE
          WHEN trim(COALESCE(p.name, '')) = '' OR length(trim(COALESCE(p.name, ''))) < 5
            THEN false
          WHEN trim(p.name) ~* '^gamestop product\\s+\\d+$'
            THEN false
          WHEN trim(p.name) ~* '^product\\s+\\d+$'
            THEN false
          WHEN trim(p.name) ~ '^\\d{5,}$'
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
          WHEN trim(p.name) ~* '^(gamestop )?product\\s+\\d+$'
            THEN 'Placeholder name: ' || trim(p.name)
          WHEN trim(p.name) ~ '^\\d{5,}$'
            THEN 'Numeric-only name: ' || trim(p.name)
          WHEN (p.product_url LIKE '%macys.com%')
               AND (p.product_url NOT LIKE '%?ID=%')
               AND (p.product_url NOT LIKE '%/ID/%')
            THEN 'Macy''s URL missing product ID'
          WHEN p.product_url IS NULL OR trim(p.product_url) = ''
            THEN 'No product URL'
          ELSE NULL
        END,
        updated_at = NOW()
      FROM stores s
      WHERE p.store_id = s.id
    `);
    const hidden = result.rowCount; // approximate — actual hidden count computed separately
    console.log(`[add-quality-gate] quality classification: ${result.rowCount} products updated`);
  } catch (err) {
    console.error('[add-quality-gate] quality classification error (non-fatal):', err.message);
  } finally {
    client2.release();
    await pool.end();
  }
}

run();

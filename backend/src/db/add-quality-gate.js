/**
 * Migration: add quality gate columns to products table.
 * Follows the same pattern as add-scanner-unknown.js (query helper, process.exit).
 *
 * quality_status:     PASS | MISSING_TITLE | PLACEHOLDER_TITLE | BROKEN_URL | INCOMPLETE_PRODUCT
 * quality_reason:     human-readable explanation
 * is_public_visible:  NULL = unchecked (defaults to visible), true = PASS, false = hidden
 */
const { query } = require('../config/database');

async function migrate() {
  // 1. Schema
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS quality_status    VARCHAR(30) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS quality_reason    TEXT        DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS is_public_visible BOOLEAN     DEFAULT NULL
  `);
  console.log('[add-quality-gate] columns added (or already existed)');

  await query(`
    CREATE INDEX IF NOT EXISTS idx_products_quality_hidden
      ON products(is_public_visible) WHERE is_public_visible = false
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_products_quality_status
      ON products(quality_status) WHERE quality_status IS NOT NULL
  `);
  console.log('[add-quality-gate] indexes ready');

  // 2. Initial quality classification (idempotent UPDATE — safe to re-run)
  const result = await query(`
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
  console.log(`[add-quality-gate] classification: ${result.rowCount} products updated`);
}

migrate()
  .catch(err => { console.error('[add-quality-gate] ERROR:', err.message); process.exit(1); })
  .then(() => process.exit(0));

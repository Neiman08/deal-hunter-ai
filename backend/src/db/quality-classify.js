/**
 * Quality classification backfill — runs after add-quality-gate.js adds the columns.
 * Separate from schema migration so a classification error never blocks column creation.
 *
 * Idempotent: re-classifies all products on every run. Safe to re-run.
 */
const { query } = require('../config/database');

async function classify() {
  const result = await query(`
    UPDATE products p SET
      quality_status = CASE
        WHEN trim(COALESCE(p.name, '')) = ''
          OR length(trim(COALESCE(p.name, ''))) < 5
          THEN 'MISSING_TITLE'
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          THEN 'PLACEHOLDER_TITLE'
        WHEN p.name ~* '^product[[:space:]]+[0-9]+$'
          THEN 'PLACEHOLDER_TITLE'
        WHEN p.name ~ '^[0-9]{5,}$'
          THEN 'PLACEHOLDER_TITLE'
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN 'BROKEN_URL'
        WHEN p.product_url IS NULL OR trim(p.product_url) = ''
          THEN 'INCOMPLETE_PRODUCT'
        ELSE 'PASS'
      END,
      is_public_visible = CASE
        WHEN trim(COALESCE(p.name, '')) = ''
          OR length(trim(COALESCE(p.name, ''))) < 5
          THEN false
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          THEN false
        WHEN p.name ~* '^product[[:space:]]+[0-9]+$'
          THEN false
        WHEN p.name ~ '^[0-9]{5,}$'
          THEN false
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN false
        WHEN p.product_url IS NULL OR trim(p.product_url) = ''
          THEN false
        ELSE true
      END,
      quality_reason = CASE
        WHEN trim(COALESCE(p.name, '')) = ''
          OR length(trim(COALESCE(p.name, ''))) < 5
          THEN 'Empty or too-short product name'
        WHEN p.name ~* '^(gamestop )?product[[:space:]]+[0-9]+$'
          THEN 'Placeholder name: ' || trim(p.name)
        WHEN p.name ~ '^[0-9]{5,}$'
          THEN 'Numeric-only name: ' || trim(p.name)
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN 'Macy''s URL missing product ID'
        WHEN p.product_url IS NULL OR trim(p.product_url) = ''
          THEN 'No product URL'
        ELSE NULL
      END,
      updated_at = NOW()
    FROM stores s
    WHERE p.store_id = s.id
    -- always re-classify (idempotent — corrects prior wrong regex runs)
  `);
  console.log(`[quality-classify] ${result.rowCount} products classified`);

  // Quick summary
  const summary = await query(`
    SELECT quality_status, COUNT(*) as n, COUNT(*) FILTER (WHERE is_public_visible = false) as hidden
    FROM products GROUP BY 1 ORDER BY 2 DESC
  `);
  for (const r of summary.rows) {
    console.log(`  ${r.quality_status || 'NULL'}: ${r.n} (${r.hidden} hidden)`);
  }
}

classify()
  .catch(err => { console.error('[quality-classify] ERROR:', err.message); process.exit(1); })
  .then(() => process.exit(0));

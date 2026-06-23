/**
 * Quality classification backfill — runs after add-quality-gate.js adds the columns.
 * Separate from schema migration so a classification error never blocks column creation.
 *
 * Statuses:
 *   PASS                 — product is complete and linkable
 *   HIDDEN_BROKEN_URL    — URL structurally missing required routing ID (Macy's)
 *   HIDDEN_GENERIC_TITLE — name is a placeholder (GameStop Product XXXXX, etc.)
 *   HIDDEN_MISSING_TITLE — name is null or too short
 *   HIDDEN_MISSING_IMAGE — no image_url
 *   NEEDS_RECOVERY       — has real name but is otherwise incomplete
 *   INCOMPLETE_PRODUCT   — no URL
 *
 * Rule: public feed only shows products WHERE is_public_visible = true AND quality_status = 'PASS'
 */
const { query } = require('../config/database');

async function classify() {
  const result = await query(`
    UPDATE products p SET
      quality_status = CASE
        WHEN trim(COALESCE(p.name, '')) = ''
          OR length(trim(COALESCE(p.name, ''))) < 5
          THEN 'HIDDEN_MISSING_TITLE'

        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          OR p.name ~* '^product[[:space:]]+[0-9]+$'
          OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
          OR p.name ~ '^[0-9]{5,}$'
          THEN 'HIDDEN_GENERIC_TITLE'

        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN 'HIDDEN_BROKEN_URL'

        WHEN p.product_url IS NULL OR trim(p.product_url) = ''
          THEN 'INCOMPLETE_PRODUCT'

        WHEN p.image_url IS NULL OR trim(p.image_url) = ''
          THEN 'HIDDEN_MISSING_IMAGE'

        ELSE 'PASS'
      END,

      is_public_visible = CASE
        WHEN trim(COALESCE(p.name, '')) = ''
          OR length(trim(COALESCE(p.name, ''))) < 5
          THEN false
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          OR p.name ~* '^product[[:space:]]+[0-9]+$'
          OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
          OR p.name ~ '^[0-9]{5,}$'
          THEN false
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN false
        WHEN p.product_url IS NULL OR trim(p.product_url) = ''
          THEN false
        WHEN p.image_url IS NULL OR trim(p.image_url) = ''
          THEN false
        ELSE true
      END,

      quality_reason = CASE
        WHEN trim(COALESCE(p.name, '')) = ''
          OR length(trim(COALESCE(p.name, ''))) < 5
          THEN 'Empty or too-short product name'
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          OR p.name ~* '^product[[:space:]]+[0-9]+$'
          OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
          THEN 'Placeholder name: ' || trim(p.name)
        WHEN p.name ~ '^[0-9]{5,}$'
          THEN 'Numeric-only name: ' || trim(p.name)
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN 'Macy''s URL missing product ID — will 404 in browser'
        WHEN p.product_url IS NULL OR trim(p.product_url) = ''
          THEN 'No product URL'
        WHEN p.image_url IS NULL OR trim(p.image_url) = ''
          THEN 'No product image'
        ELSE NULL
      END,

      last_quality_check_at = NOW(),
      updated_at = NOW()
    -- No stores JOIN: URL pattern detection is store-agnostic
  `);
  console.log(`[quality-classify] ${result.rowCount} products classified`);

  const summary = await query(`
    SELECT
      quality_status,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE is_public_visible = true)     AS visible,
      COUNT(*) FILTER (WHERE is_public_visible = false)    AS hidden
    FROM products
    GROUP BY 1
    ORDER BY total DESC
  `);
  for (const r of summary.rows) {
    console.log(`  [quality-classify] ${(r.quality_status || 'NULL').padEnd(25)} total=${r.total}  visible=${r.visible}  hidden=${r.hidden}`);
  }
}

classify()
  .catch(err => { console.error('[quality-classify] ERROR:', err.message); process.exit(1); })
  .then(() => process.exit(0));

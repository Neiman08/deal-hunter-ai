/**
 * Macy's URL repair job (idempotent, safe to run multiple times).
 * Reconstructs /ID/{sku} for any product with a numeric SKU that is missing it.
 */
const { query } = require('../config/database');

async function run() {
  // 1. Numeric SKU → append /ID/{sku}
  const fix = await query(`
    UPDATE products
    SET product_url = product_url || '/ID/' || sku,
        updated_at  = NOW()
    WHERE store_id  = (SELECT id FROM stores WHERE slug = 'macys')
      AND sku       ~ '^[0-9]+$'
      AND product_url IS NOT NULL
      AND product_url NOT LIKE '%/ID/%'
  `);
  console.log(`[macys-fix] numeric SKU URLs fixed: ${fix.rowCount}`);

  // 2. Missing product_url but has numeric SKU → build from scratch
  const rebuild = await query(`
    UPDATE products
    SET product_url = 'https://www.macys.com/shop/product/' ||
                      LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) ||
                      '/ID/' || sku,
        updated_at  = NOW()
    WHERE store_id  = (SELECT id FROM stores WHERE slug = 'macys')
      AND sku       ~ '^[0-9]+$'
      AND (product_url IS NULL OR product_url = '')
  `);
  console.log(`[macys-fix] rebuilt from scratch: ${rebuild.rowCount}`);

  // 3. Audit report
  const audit = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE product_url LIKE '%/ID/%') as with_direct_url,
      COUNT(*) FILTER (WHERE product_url IS NULL OR product_url NOT LIKE '%/ID/%') as needs_search_fallback
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'macys'
  `);
  const r = audit.rows[0];
  console.log(`[macys-fix] Audit: ${r.total} total | ${r.with_direct_url} direct URLs | ${r.needs_search_fallback} using search fallback`);
}

run()
  .catch(err => { console.error('[macys-fix] error:', err.message); process.exit(1); })
  .then(() => process.exit(0));

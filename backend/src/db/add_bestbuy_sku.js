/**
 * Migration: add bestbuy_sku column to products table
 *
 * Por qué columna separada y no reutilizar sku:
 *   - sku es el identificador del fabricante: DCK240C2, OLED65C3PUA, V11-ABSOLUTE
 *   - bestbuy_sku es el ID interno numérico de Best Buy: 6505727, 6396720
 *   - Son conceptos distintos. Un mismo producto puede tener ambos.
 *   - El scraper de Best Buy SOLO usa bestbuy_sku. Nunca toca sku.
 *
 * Run once:
 *   node src/db/add_bestbuy_sku.js
 */

require('dotenv').config({ path: '../../.env' });
const { pool } = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Add the column (idempotent)
    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS bestbuy_sku VARCHAR(20) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS bestbuy_sku_valid BOOLEAN DEFAULT NULL;
    `);

    // 2. Index for fast lookup by bestbuy_sku
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_bestbuy_sku
        ON products(bestbuy_sku)
        WHERE bestbuy_sku IS NOT NULL;
    `);

    // 3. For existing BB products whose sku column is already numeric,
    //    copy it to bestbuy_sku and mark valid
    await client.query(`
      UPDATE products p
      SET
        bestbuy_sku       = p.sku,
        bestbuy_sku_valid = true
      FROM stores s
      WHERE p.store_id = s.id
        AND s.slug = 'best-buy'
        AND p.sku ~ '^[0-9]{5,8}$'
        AND p.bestbuy_sku IS NULL;
    `);

    // 4. For existing BB products whose sku is a manufacturer model number,
    //    mark as invalid so the scraper skips them with a clear message
    await client.query(`
      UPDATE products p
      SET bestbuy_sku_valid = false
      FROM stores s
      WHERE p.store_id = s.id
        AND s.slug = 'best-buy'
        AND (p.sku IS NULL OR p.sku !~ '^[0-9]{5,8}$')
        AND p.bestbuy_sku IS NULL;
    `);

    await client.query('COMMIT');

    // Report what we did
    const res = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE bestbuy_sku_valid = true)  AS valid_count,
        COUNT(*) FILTER (WHERE bestbuy_sku_valid = false) AS invalid_count,
        COUNT(*) FILTER (WHERE bestbuy_sku IS NOT NULL)   AS with_sku
      FROM products p
      JOIN stores s ON p.store_id = s.id
      WHERE s.slug = 'best-buy'
    `);
    const r = res.rows[0];
    console.log('✅ bestbuy_sku migration complete');
    console.log(`   valid (numeric):   ${r.valid_count}`);
    console.log(`   invalid (model#):  ${r.invalid_count}`);
    console.log(`   with bestbuy_sku:  ${r.with_sku}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

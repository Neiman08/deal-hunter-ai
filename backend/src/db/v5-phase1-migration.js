const { query } = require('../config/database');

async function migrate() {
  // 1. Add missing columns to submitted_deals
  await query(`
    ALTER TABLE submitted_deals
    ADD COLUMN IF NOT EXISTS roi_percent         NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS opportunity_score   INTEGER,
    ADD COLUMN IF NOT EXISTS recommendation      TEXT,
    ADD COLUMN IF NOT EXISTS effective_market_price  NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS effective_market_source TEXT,
    ADD COLUMN IF NOT EXISTS keepa_confidence    INTEGER,
    ADD COLUMN IF NOT EXISTS store_location_id   UUID REFERENCES store_locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS feedback_tag        TEXT
  `);
  console.log('[v5-phase1] submitted_deals columns added');

  // 2. Fix Macy's product_url — append /ID/{sku} for numeric SKUs missing it
  const { rowCount } = await query(`
    UPDATE products
    SET product_url = product_url || '/ID/' || sku,
        updated_at  = NOW()
    WHERE store_id  = (SELECT id FROM stores WHERE slug = 'macys')
      AND sku       ~ '^[0-9]+$'
      AND product_url IS NOT NULL
      AND product_url NOT LIKE '%/ID/%'
  `);
  console.log(`[v5-phase1] Macy's URLs fixed: ${rowCount} rows updated`);

  // 3. Add referred_by column to users if missing (needed by referral apply route)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT`);
  console.log('[v5-phase1] users.referred_by ensured');
}

migrate()
  .catch(err => { console.error('[v5-phase1] error:', err.message); process.exit(1); })
  .then(() => process.exit(0));

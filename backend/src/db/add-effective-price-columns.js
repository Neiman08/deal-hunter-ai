const { query } = require('../config/database');

async function migrate() {
  await query(`
    ALTER TABLE product_market_data
    ADD COLUMN IF NOT EXISTS effective_market_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS effective_market_source TEXT,
    ADD COLUMN IF NOT EXISTS pricing_confidence INTEGER DEFAULT 0
  `);

  // Backfill existing rows where columns are null
  const { rowCount } = await query(`
    UPDATE product_market_data
    SET
      effective_market_price = COALESCE(
        amazon_buy_box_price,
        amazon_current_price,
        amazon_90d_avg_price,
        amazon_180d_avg_price
      ),
      effective_market_source = CASE
        WHEN amazon_buy_box_price  IS NOT NULL THEN 'buy_box'
        WHEN amazon_current_price  IS NOT NULL THEN 'amazon_current'
        WHEN amazon_90d_avg_price  IS NOT NULL THEN 'amazon_90d_avg'
        WHEN amazon_180d_avg_price IS NOT NULL THEN 'amazon_180d_avg'
        ELSE 'none'
      END,
      pricing_confidence = CASE
        WHEN amazon_buy_box_price  IS NOT NULL THEN 90
        WHEN amazon_current_price  IS NOT NULL THEN 80
        WHEN amazon_90d_avg_price  IS NOT NULL THEN 60
        WHEN amazon_180d_avg_price IS NOT NULL THEN 40
        ELSE 0
      END
    WHERE effective_market_price IS NULL
  `);

  console.log(`[Migration] effective_market_price columns added; ${rowCount} rows backfilled`);
}

migrate()
  .catch(err => { console.error('[Migration] error:', err.message); process.exit(1); })
  .then(() => process.exit(0));

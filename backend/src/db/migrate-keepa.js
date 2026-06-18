require('dotenv').config({ path: '../.env' });
const { pool } = require('../config/database');

async function migrateKeepa() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[migrate-keepa] Running Keepa + scanner migrations...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS product_market_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        upc TEXT,
        asin TEXT,
        source TEXT NOT NULL DEFAULT 'keepa',
        title TEXT,
        brand TEXT,
        image_url TEXT,
        amazon_current_price NUMERIC(10,2),
        amazon_buy_box_price NUMERIC(10,2),
        amazon_90d_avg_price NUMERIC(10,2),
        amazon_180d_avg_price NUMERIC(10,2),
        amazon_new_price NUMERIC(10,2),
        amazon_used_price NUMERIC(10,2),
        sales_rank INTEGER,
        category TEXT,
        is_amazon_in_stock BOOLEAN,
        offers_count INTEGER,
        keepa_confidence INTEGER DEFAULT 0,
        raw_summary JSONB DEFAULT '{}'::jsonb,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Unique constraints — add separately to avoid errors if already exist
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE product_market_data ADD CONSTRAINT uq_pmd_source_asin UNIQUE (source, asin);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE product_market_data ADD CONSTRAINT uq_pmd_source_upc UNIQUE (source, upc);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_product_market_data_product_id ON product_market_data(product_id);
      CREATE INDEX IF NOT EXISTS idx_product_market_data_upc ON product_market_data(upc);
      CREATE INDEX IF NOT EXISTS idx_product_market_data_asin ON product_market_data(asin);
      CREATE INDEX IF NOT EXISTS idx_product_market_data_fetched_at ON product_market_data(fetched_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS scanner_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        code_type TEXT DEFAULT 'upc',
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        found_internal BOOLEAN DEFAULT false,
        in_store_price NUMERIC(10,2),
        store_slug TEXT,
        evaluation JSONB DEFAULT '{}'::jsonb,
        keepa_asin TEXT,
        keepa_confidence INTEGER,
        scanned_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scanner_history_user ON scanner_history(user_id, scanned_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scanner_history_code ON scanner_history(code);
    `);

    // eBay market data table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ebay_market_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        upc TEXT UNIQUE,
        search_query TEXT,
        avg_sold_price NUMERIC(10,2),
        min_price NUMERIC(10,2),
        max_price NUMERIC(10,2),
        median_price NUMERIC(10,2),
        sold_count INTEGER,
        active_listings INTEGER,
        top_item_id TEXT,
        top_item_url TEXT,
        raw_summary JSONB DEFAULT '{}'::jsonb,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ebay_market_data_product_id ON ebay_market_data(product_id);
      CREATE INDEX IF NOT EXISTS idx_ebay_market_data_upc ON ebay_market_data(upc);
      CREATE INDEX IF NOT EXISTS idx_ebay_market_data_fetched_at ON ebay_market_data(fetched_at DESC);
    `);

    await client.query('COMMIT');
    console.log('[migrate-keepa] Done — product_market_data + scanner_history + ebay_market_data created');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-keepa] Failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateKeepa().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { migrateKeepa };

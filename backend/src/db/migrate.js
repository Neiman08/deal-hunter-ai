require('dotenv').config({ path: '../.env' });
const { pool } = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔧 Running migrations v4 (Final Release)...');

    // Core tables
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      plan VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free','pro','elite')),
      zip_code VARCHAR(10), latitude DECIMAL(10,8), longitude DECIMAL(11,8),
      is_admin BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true,
      stripe_customer_id VARCHAR(255), stripe_subscription_id VARCHAR(255),
      plan_expires_at TIMESTAMP, preferences JSONB DEFAULT '{}',
      referred_by VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS stores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL, slug VARCHAR(50) UNIQUE NOT NULL,
      logo_url VARCHAR(500), website_url VARCHAR(500), color VARCHAR(7) DEFAULT '#3B82F6',
      api_available BOOLEAN DEFAULT false, scraping_enabled BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true, scraper_module VARCHAR(100),
      last_scanned_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS store_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
      store_number VARCHAR(50), name VARCHAR(255), address VARCHAR(500),
      city VARCHAR(100), state VARCHAR(5), zip_code VARCHAR(10),
      latitude DECIMAL(10,8), longitude DECIMAL(11,8),
      phone VARCHAR(20), hours JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL, slug VARCHAR(50) UNIQUE NOT NULL,
      icon VARCHAR(50), demand_score DECIMAL(3,2) DEFAULT 0.50,
      parent_id UUID REFERENCES categories(id), created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      upc VARCHAR(30), sku VARCHAR(100), name VARCHAR(500) NOT NULL,
      bestbuy_sku VARCHAR(20) DEFAULT NULL,
      bestbuy_sku_valid BOOLEAN DEFAULT NULL,
      brand VARCHAR(200), model VARCHAR(200),
      category_id UUID REFERENCES categories(id),
      store_id UUID REFERENCES stores(id),
      image_url VARCHAR(1000), product_url VARCHAR(1000), description TEXT, tags TEXT[],
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(upc, store_id), UNIQUE(sku, store_id)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS prices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      store_location_id UUID REFERENCES store_locations(id),
      regular_price DECIMAL(10,2) NOT NULL, current_price DECIMAL(10,2) NOT NULL,
      discount_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN regular_price > 0 THEN ROUND(((regular_price-current_price)/regular_price*100)::NUMERIC,2) ELSE 0 END
      ) STORED,
      in_stock BOOLEAN DEFAULT true, stock_quantity INTEGER,
      source VARCHAR(50) DEFAULT 'scraper', recorded_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      store_id UUID REFERENCES stores(id),
      store_location_id UUID REFERENCES store_locations(id),
      regular_price DECIMAL(10,2), deal_price DECIMAL(10,2), discount_percent DECIMAL(5,2),
      savings_amount DECIMAL(10,2) GENERATED ALWAYS AS (regular_price - deal_price) STORED,
      resale_price_amazon DECIMAL(10,2), resale_price_ebay DECIMAL(10,2),
      resale_price_facebook DECIMAL(10,2), amazon_fees DECIMAL(10,2),
      ebay_fees DECIMAL(10,2), shipping_estimate DECIMAL(10,2),
      estimated_profit DECIMAL(10,2), roi_percent DECIMAL(8,2),
      demand_level VARCHAR(20), estimated_days_to_sell INTEGER,
      opportunity_score INTEGER DEFAULT 0 CHECK (opportunity_score BETWEEN 0 AND 100),
      opportunity_label VARCHAR(50), score_breakdown JSONB DEFAULT '{}',
      stock_quantity INTEGER, is_error_price BOOLEAN DEFAULT false,
      price_trend VARCHAR(20) DEFAULT 'unknown',
      liquidation_type VARCHAR(30), liquidation_badge VARCHAR(50),
      liquidation_color VARCHAR(7), liquidation_confidence VARCHAR(10),
      is_active BOOLEAN DEFAULT true, expires_at TIMESTAMP,
      detected_at TIMESTAMP DEFAULT NOW(), last_seen_at TIMESTAMP DEFAULT NOW(),
        data_source VARCHAR(10) DEFAULT 'demo' CHECK (data_source IN ('demo','live')),
      UNIQUE(product_id, store_id)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS store_inventory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      store_location_id UUID REFERENCES store_locations(id) ON DELETE CASCADE,
      quantity_on_hand INTEGER DEFAULT 0,
      in_stock BOOLEAN DEFAULT false,
      clearance_price DECIMAL(10,2),
      is_clearance BOOLEAN DEFAULT false,
      checked_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(product_id, store_location_id)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS market_comparisons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      upc VARCHAR(30) UNIQUE,
      product_name VARCHAR(500),
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS user_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255), store_id UUID REFERENCES stores(id),
      category_id UUID REFERENCES categories(id),
      product_keyword VARCHAR(255), brands TEXT[],
      min_discount_percent DECIMAL(5,2) DEFAULT 30, min_profit DECIMAL(10,2) DEFAULT 0,
      min_score INTEGER DEFAULT 0, max_distance_miles INTEGER DEFAULT 25,
      zip_code VARCHAR(10), state_filter VARCHAR(5),
      notify_email BOOLEAN DEFAULT true, notify_whatsapp BOOLEAN DEFAULT false,
      notify_push BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true, last_triggered_at TIMESTAMP,
      trigger_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS watchlist_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) CHECK (type IN ('brand','category','upc','sku','product_id','keyword')),
      value VARCHAR(255) NOT NULL, label VARCHAR(255),
      product_id UUID REFERENCES products(id),
      min_discount INTEGER DEFAULT 20,
      notify_email BOOLEAN DEFAULT true, notify_whatsapp BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, type, value)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS user_favorites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) CHECK (type IN ('brand','product','store','category')),
      value VARCHAR(255) NOT NULL,
      store_id UUID REFERENCES stores(id), product_id UUID REFERENCES products(id),
      category_id UUID REFERENCES categories(id),
      created_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id, type, value)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      deal_id UUID REFERENCES deals(id),
      alert_id UUID REFERENCES user_alerts(id),
      channel VARCHAR(20) CHECK (channel IN ('email','whatsapp','sms','push')),
      status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent','failed','pending')),
      message_body TEXT, sent_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS saved_deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
      notes TEXT, purchased BOOLEAN DEFAULT false,
      purchase_price DECIMAL(10,2), actual_profit DECIMAL(10,2),
      saved_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id, deal_id)
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS scan_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id UUID REFERENCES stores(id), store_name VARCHAR(100),
      status VARCHAR(20) CHECK (status IN ('running','success','error','partial')),
      products_scanned INTEGER DEFAULT 0, deals_found INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0, error_details TEXT,
      duration_seconds INTEGER,
      started_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS user_activity (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(50), deal_id UUID REFERENCES deals(id),
      product_id UUID REFERENCES products(id),
      metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS revenue_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      event_type VARCHAR(50), amount_cents INTEGER, plan VARCHAR(20),
      stripe_event_id VARCHAR(255) UNIQUE, created_at TIMESTAMP DEFAULT NOW()
    );`);

    // Referral system
    await client.query(`CREATE TABLE IF NOT EXISTS referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      code VARCHAR(20) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );`);

    await client.query(`CREATE TABLE IF NOT EXISTS referral_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      referrer_id UUID REFERENCES users(id),
      referee_id UUID REFERENCES users(id) UNIQUE,
      code VARCHAR(20), converted_to_paid BOOLEAN DEFAULT false,
      converted_at TIMESTAMP, reward_months INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );`);

    // Audit & security
    await client.query(`CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      action VARCHAR(100) NOT NULL,
      details JSONB DEFAULT '{}',
      ip_address INET, user_agent VARCHAR(300),
      created_at TIMESTAMP DEFAULT NOW()
    );`);

    // Performance indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_deals_score ON deals(opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS idx_deals_active_score ON deals(is_active, opportunity_score DESC);
      CREATE INDEX IF NOT EXISTS idx_deals_store ON deals(store_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_deals_detected ON deals(detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deals_liq ON deals(liquidation_type) WHERE liquidation_type IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_bestbuy_sku ON products(bestbuy_sku) WHERE bestbuy_sku IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
      CREATE INDEX IF NOT EXISTS idx_store_inventory_product ON store_inventory(product_id);
      CREATE INDEX IF NOT EXISTS idx_store_locs_coords ON store_locations(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_alerts_user ON user_alerts(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist_items(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, sent_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
      CREATE INDEX IF NOT EXISTS idx_market_upc ON market_comparisons(upc);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration v4 complete — 20 tables, full production schema');
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

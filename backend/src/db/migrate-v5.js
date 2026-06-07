/**
 * Migration v5 — Multi-retailer expansion
 *
 * Adds:
 *   1. New stores: TJ Maxx, Marshalls, Kohl's, Costco, Sam's Club,
 *      Walgreens, CVS, Nordstrom Rack, GameStop
 *   2. Phase 5: ZIP-code inventory fields + pickup_available
 *   3. Phase 9: hidden_deals, markdown_history, price_changes tables
 *   4. Phase 6: alert_triggers table for watchlist-based alerts
 *   5. Resale confidence field on deals
 *   6. New indexes for performance
 */

require('dotenv').config({ path: '../.env' });
const { pool } = require('../config/database');

async function migrateV5() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔧 Running migration v5...');

    // ── Phase 5: Enhance store_inventory for ZIP / pickup ─────────────────────
    await client.query(`
      ALTER TABLE store_inventory
        ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(20) DEFAULT 'unknown'
          CHECK (inventory_status IN ('in_stock','low_stock','out_of_stock','unknown')),
        ADD COLUMN IF NOT EXISTS pickup_available BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS same_day_delivery BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS zip_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP DEFAULT NOW();
    `);
    console.log('  ✅ store_inventory enhanced for ZIP/pickup (Phase 5)');

    // ── Phase 5: ZIP-level inventory tracking ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS zip_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
        zip_code VARCHAR(10) NOT NULL,
        in_stock BOOLEAN DEFAULT false,
        quantity INTEGER,
        pickup_available BOOLEAN DEFAULT false,
        clearance_price DECIMAL(10,2),
        checked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, store_id, zip_code)
      );
      CREATE INDEX IF NOT EXISTS idx_zip_inventory_zip ON zip_inventory(zip_code, store_id);
      CREATE INDEX IF NOT EXISTS idx_zip_inventory_product ON zip_inventory(product_id, in_stock);
    `);
    console.log('  ✅ zip_inventory table created (Phase 5)');

    // ── Phase 6: Alert triggers tracking ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_triggers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        alert_id UUID REFERENCES user_alerts(id) ON DELETE CASCADE,
        deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        triggered_at TIMESTAMP DEFAULT NOW(),
        channel VARCHAR(20),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','suppressed')),
        roi_at_trigger DECIMAL(8,2),
        profit_at_trigger DECIMAL(10,2),
        UNIQUE(alert_id, deal_id)
      );
      CREATE INDEX IF NOT EXISTS idx_alert_triggers_user ON alert_triggers(user_id, triggered_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alert_triggers_deal ON alert_triggers(deal_id);
    `);
    console.log('  ✅ alert_triggers table created (Phase 6)');

    // ── Phase 7/8: Resale confidence on deals ─────────────────────────────────
    await client.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS resale_confidence VARCHAR(6) DEFAULT 'MEDIUM'
          CHECK (resale_confidence IN ('LOW','MEDIUM','HIGH')),
        ADD COLUMN IF NOT EXISTS resale_velocity VARCHAR(20) DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS opportunity_tier VARCHAR(20) DEFAULT 'Regular'
          CHECK (opportunity_tier IN ('Error Price','Elite Deal','Excellent Deal','Good Deal','Regular'));
    `);
    console.log('  ✅ deals enhanced with resale_confidence + opportunity_tier (Phase 7/8)');

    // ── Phase 9: Price changes tracking (for penny items) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_changes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        store_id UUID REFERENCES stores(id),
        old_price DECIMAL(10,2),
        new_price DECIMAL(10,2),
        change_percent DECIMAL(8,2) GENERATED ALWAYS AS (
          CASE WHEN old_price > 0
            THEN ROUND(((new_price - old_price) / old_price * 100)::NUMERIC, 2)
            ELSE 0 END
        ) STORED,
        change_type VARCHAR(20) CHECK (change_type IN ('markdown','rollback','clearance','penny','unknown')),
        detected_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_price_changes_product ON price_changes(product_id, detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_changes_type ON price_changes(change_type, detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_changes_penny ON price_changes(change_type) WHERE change_type='penny';
    `);
    console.log('  ✅ price_changes table created (Phase 9)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS markdown_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        store_id UUID REFERENCES stores(id),
        markdown_date DATE NOT NULL,
        original_price DECIMAL(10,2),
        marked_down_price DECIMAL(10,2),
        markdown_pct DECIMAL(8,2) GENERATED ALWAYS AS (
          CASE WHEN original_price > 0
            THEN ROUND(((original_price - marked_down_price) / original_price * 100)::NUMERIC, 2)
            ELSE 0 END
        ) STORED,
        is_final_markdown BOOLEAN DEFAULT false,
        UNIQUE(product_id, store_id, markdown_date)
      );
      CREATE INDEX IF NOT EXISTS idx_markdown_history_product ON markdown_history(product_id, markdown_date DESC);
      CREATE INDEX IF NOT EXISTS idx_markdown_final ON markdown_history(is_final_markdown) WHERE is_final_markdown=true;
    `);
    console.log('  ✅ markdown_history table created (Phase 9)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS hidden_deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        store_id UUID REFERENCES stores(id),
        deal_type VARCHAR(30) CHECK (deal_type IN
          ('penny_item','final_markdown','clearance_extreme','manager_special',
           'internal_markdown','discontinued','seasonal_clearance')),
        listed_price DECIMAL(10,2),
        actual_price DECIMAL(10,2),
        confidence VARCHAR(6) DEFAULT 'MEDIUM' CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
        evidence JSONB DEFAULT '{}',
        zip_code VARCHAR(10),
        verified_at TIMESTAMP,
        expires_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_hidden_deals_type ON hidden_deals(deal_type, is_active);
      CREATE INDEX IF NOT EXISTS idx_hidden_deals_store ON hidden_deals(store_id, is_active);
    `);
    console.log('  ✅ hidden_deals table created (Phase 9)');

    // ── New stores: TJ Maxx, Marshalls, Kohl's, Costco, Sam's Club, etc. ──────
    const newStores = [
      { name: 'TJ Maxx',        slug: 'tj-maxx',        color: '#CC0000', url: 'https://tjmaxx.tjx.com' },
      { name: 'Marshalls',      slug: 'marshalls',      color: '#005BAC', url: 'https://marshalls.com' },
      { name: "Kohl's",         slug: 'kohls',          color: '#3B3B3B', url: 'https://kohls.com' },
      { name: 'Costco',         slug: 'costco',         color: '#005CA9', url: 'https://costco.com' },
      { name: "Sam's Club",     slug: 'sams-club',      color: '#003087', url: 'https://samsclub.com' },
      { name: 'Walgreens',      slug: 'walgreens',      color: '#E31837', url: 'https://walgreens.com' },
      { name: 'CVS',            slug: 'cvs',            color: '#CC0000', url: 'https://cvs.com' },
      { name: 'Nordstrom Rack', slug: 'nordstrom-rack', color: '#1A1A1A', url: 'https://nordstromrack.com' },
      { name: 'GameStop',       slug: 'gamestop',       color: '#5CB85C', url: 'https://gamestop.com' },
      { name: 'Office Depot',   slug: 'office-depot',   color: '#CC0000', url: 'https://officedepot.com' },
      { name: 'Staples',        slug: 'staples',        color: '#CC0000', url: 'https://staples.com' },
    ];
    for (const s of newStores) {
      await client.query(
        `INSERT INTO stores (name, slug, color, website_url, is_active)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name`,
        [s.name, s.slug, s.color, s.url]
      );
    }
    console.log(`  ✅ ${newStores.length} new stores registered`);

    // ── New categories ─────────────────────────────────────────────────────────
    const newCats = [
      { name: 'Handbags & Accessories', slug: 'handbags', icon: '👜', demand_score: 0.75 },
      { name: 'Shoes',                  slug: 'shoes',    icon: '👟', demand_score: 0.70 },
      { name: 'Jewelry',                slug: 'jewelry',  icon: '💍', demand_score: 0.80 },
      { name: 'Luggage & Travel',        slug: 'luggage',  icon: '🧳', demand_score: 0.65 },
      { name: 'Bedding & Bath',          slug: 'bedding',  icon: '🛏️', demand_score: 0.55 },
      { name: 'Video Games',             slug: 'gaming',   icon: '🎮', demand_score: 0.80 },
      { name: 'Health & Beauty',         slug: 'health-beauty', icon: '💄', demand_score: 0.60 },
      { name: 'Office & Supplies',       slug: 'office',   icon: '📋', demand_score: 0.50 },
      { name: 'Sports & Outdoors',       slug: 'sports',   icon: '⚽', demand_score: 0.60 },
    ];
    for (const c of newCats) {
      await client.query(
        `INSERT INTO categories (name, slug, icon, demand_score) VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET demand_score=EXCLUDED.demand_score`,
        [c.name, c.slug, c.icon, c.demand_score]
      );
    }
    console.log(`  ✅ ${newCats.length} new categories registered`);

    // ── New performance indexes ────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_deals_tier ON deals(opportunity_tier, is_active);
      CREATE INDEX IF NOT EXISTS idx_deals_confidence ON deals(resale_confidence, is_active);
      CREATE INDEX IF NOT EXISTS idx_products_url ON products(product_url) WHERE product_url IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_prices_recorded ON prices(recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deals_profit ON deals(estimated_profit DESC) WHERE is_active=true;
    `);
    console.log('  ✅ New indexes created (Phase 10)');

    await client.query('COMMIT');
    console.log('\n✅ Migration v5 complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration v5 failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateV5().catch(e => { console.error(e); process.exit(1); });

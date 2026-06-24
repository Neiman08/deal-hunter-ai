/**
 * migrate-categories.js — One-time data quality fix (idempotent).
 *
 * 1. Re-categorize products whose category was incorrectly set to the default
 *    (first alphabetically = "Appliances") during discovery.
 * 2. Re-activate deals that have discount ≥ 20% and last_seen_at within 14 days
 *    but were deactivated by the old 7-day cleanup window.
 *
 * Safe to run on every start — uses a migrations tracking table to run only once.
 */

const { query } = require('../config/database');
const logger = require('../utils/logger');

async function migrateCategoriesAndReactivate() {
  // Track migrations so this only runs once per environment
  await query(`
    CREATE TABLE IF NOT EXISTS db_migrations (
      name        VARCHAR(100) PRIMARY KEY,
      ran_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Schema fixes — always run (fast, idempotent ALTER TABLE IF NOT EXISTS) ─
  // collaborator_profiles missing columns
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS approved_deals_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS rejected_deals_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS pending_deals_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS submissions_today INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS last_submission_date DATE`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS level VARCHAR(30) DEFAULT 'Rookie Hunter'`);

  // submitted_deals missing columns (added by scanner/community routes but not in base migration)
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS roi_percent DECIMAL(8,2)`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS opportunity_score INTEGER`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS recommendation TEXT`);
  await query(`ALTER TABLE submitted_deals ALTER COLUMN recommendation TYPE TEXT`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS effective_market_price DECIMAL(10,2)`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS effective_market_source VARCHAR(30)`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS keepa_confidence INTEGER`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS store_location_id UUID REFERENCES store_locations(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS feedback_tag VARCHAR(50)`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS photo_url TEXT`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS confirmation_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS negative_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS trust_threshold INTEGER DEFAULT 2`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS points_awarded BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE submitted_deals ADD COLUMN IF NOT EXISTS points_pending INTEGER DEFAULT 0`);

  // submitted_deals status constraint update (allow all community statuses)
  await query(`ALTER TABLE submitted_deals DROP CONSTRAINT IF EXISTS submitted_deals_status_check`);
  await query(`ALTER TABLE submitted_deals ADD CONSTRAINT submitted_deals_status_check
    CHECK (status IN ('pending','submitted','pending_confirmation','verified','official','rejected','expired','duplicate','approved'))`);

  // submitted_deal_confirmations table + constraint
  await query(`CREATE TABLE IF NOT EXISTS submitted_deal_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_deal_id UUID NOT NULL REFERENCES submitted_deals(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    confirmation_type VARCHAR(30) NOT NULL DEFAULT 'price_confirmed',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`ALTER TABLE submitted_deal_confirmations DROP CONSTRAINT IF EXISTS submitted_deal_confirmations_confirmation_type_check`);
  await query(`ALTER TABLE submitted_deal_confirmations ADD CONSTRAINT submitted_deal_confirmations_confirmation_type_check
    CHECK (confirmation_type IN ('price_confirmed','in_stock','out_of_stock','price_mismatch','not_found','wrong_product','expired','great_deal'))`);

  // contributor_earnings table
  await query(`CREATE TABLE IF NOT EXISTS contributor_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_deal_id UUID REFERENCES submitted_deals(id) ON DELETE SET NULL,
    earning_type VARCHAR(30) NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  const already = await query(
    "SELECT 1 FROM db_migrations WHERE name='categories_v1_reactivate_14d'"
  );
  if (already.rows.length) {
    logger.info('[migrate-categories] already applied — skipping data fixes');
    return;
  }

  logger.info('[migrate-categories] applying category fixes + 14-day reactivation...');

  // ── 1. Re-categorize Office Depot products ────────────────────────────────
  const appliancesCatId = "(SELECT id FROM categories WHERE slug='appliances' LIMIT 1)";

  await query(`
    UPDATE products SET category_id = (SELECT id FROM categories WHERE slug='electronics' LIMIT 1)
    WHERE store_id = (SELECT id FROM stores WHERE slug='office-depot' LIMIT 1)
      AND category_id = ${appliancesCatId}
      AND (name ILIKE '%laptop%' OR name ILIKE '%monitor%' OR name ILIKE '%tablet%'
        OR name ILIKE '%computer%' OR name ILIKE '%desktop%' OR name ILIKE '%chromebook%'
        OR name ILIKE '%webcam%' OR name ILIKE '%router%' OR name ILIKE '%headphone%'
        OR name ILIKE '%speaker%' OR name ILIKE '%hard drive%' OR name ILIKE '%ssd%'
        OR name ILIKE '%flash drive%' OR name ILIKE '%keyboard%' OR name ILIKE '%mouse%')
  `);

  await query(`
    UPDATE products SET category_id = (SELECT id FROM categories WHERE slug='office' LIMIT 1)
    WHERE store_id = (SELECT id FROM stores WHERE slug='office-depot' LIMIT 1)
      AND category_id = ${appliancesCatId}
      AND (name ILIKE '%printer%' OR name ILIKE '%toner%' OR name ILIKE '%ink%'
        OR name ILIKE '%shredder%' OR name ILIKE '%scanner%' OR name ILIKE '%laminator%'
        OR name ILIKE '%paper%' OR name ILIKE '%binder%' OR name ILIKE '%staple%')
  `);

  await query(`
    UPDATE products SET category_id = (SELECT id FROM categories WHERE slug='home-decor' LIMIT 1)
    WHERE store_id = (SELECT id FROM stores WHERE slug='office-depot' LIMIT 1)
      AND category_id = ${appliancesCatId}
      AND (name ILIKE '%chair%' OR name ILIKE '%desk%' OR name ILIKE '%table%'
        OR name ILIKE '%shelv%' OR name ILIKE '%cabinet%' OR name ILIKE '%bookcase%'
        OR name ILIKE '%stand%' OR name ILIKE '%mat%' OR name ILIKE '%storage%')
  `);

  // ── 2. Re-categorize GameStop toys/apparel ────────────────────────────────
  await query(`
    UPDATE products SET category_id = (SELECT id FROM categories WHERE slug='toys' LIMIT 1)
    WHERE store_id = (SELECT id FROM stores WHERE slug='gamestop' LIMIT 1)
      AND (name ILIKE '%funko%' OR name ILIKE '%lego%' OR name ILIKE '%action figure%'
        OR name ILIKE '%plush%' OR name ILIKE '%figure%')
  `);

  await query(`
    UPDATE products SET category_id = (SELECT id FROM categories WHERE slug='clothing' LIMIT 1)
    WHERE store_id = (SELECT id FROM stores WHERE slug='gamestop' LIMIT 1)
      AND (name ILIKE '%shirt%' OR name ILIKE '%hoodie%' OR name ILIKE '%hat%'
        OR name ILIKE '%jacket%' OR name ILIKE '%apparel%' OR name ILIKE '%tee%')
  `);

  // ── 3. Re-activate deals deactivated by old 7-day window ──────────────────
  const result = await query(`
    UPDATE deals SET is_active = true
    WHERE is_active = false
      AND discount_percent >= 20
      AND last_seen_at >= NOW() - INTERVAL '14 days'
  `);
  logger.info(`[migrate-categories] reactivated ${result.rowCount} deals within 14-day window`);

  // ── 4. Mark migration complete ────────────────────────────────────────────
  await query(
    "INSERT INTO db_migrations (name) VALUES ('categories_v1_reactivate_14d') ON CONFLICT DO NOTHING"
  );

  logger.info('[migrate-categories] ✅ done');

  // ── 5. Extended reactivation: 30-day window (second pass, separate migration) ─
  const alreadyV2 = await query(
    "SELECT 1 FROM db_migrations WHERE name='categories_v2_reactivate_30d'"
  );
  if (!alreadyV2.rows.length) {
    const result2 = await query(`
      UPDATE deals SET is_active = true
      WHERE is_active = false
        AND discount_percent >= 20
        AND last_seen_at >= NOW() - INTERVAL '30 days'
    `);
    logger.info(`[migrate-categories] v2: reactivated ${result2.rowCount} additional deals within 30-day window`);
    await query(
      "INSERT INTO db_migrations (name) VALUES ('categories_v2_reactivate_30d') ON CONFLICT DO NOTHING"
    );
  }
}

module.exports = { migrateCategoriesAndReactivate };

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
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS approved_deals_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS rejected_deals_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS pending_deals_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS submissions_today INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS last_submission_date DATE`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS level VARCHAR(30) DEFAULT 'Rookie Hunter'`);

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
}

module.exports = { migrateCategoriesAndReactivate };

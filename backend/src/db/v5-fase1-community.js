const { query } = require('../config/database');

async function migrate() {
  // ── 1. Update submitted_deals status CHECK constraint ─────────────────────
  await query(`ALTER TABLE submitted_deals DROP CONSTRAINT IF EXISTS submitted_deals_status_check`);
  await query(`
    ALTER TABLE submitted_deals
    ADD CONSTRAINT submitted_deals_status_check
    CHECK (status IN (
      'submitted', 'pending_confirmation', 'verified', 'official',
      'rejected', 'expired', 'duplicate', 'pending', 'approved'
    ))
  `);
  console.log('[fase1] submitted_deals status constraint updated');

  // ── 2. Add new columns to submitted_deals ─────────────────────────────────
  await query(`
    ALTER TABLE submitted_deals
    ADD COLUMN IF NOT EXISTS photo_url           TEXT,
    ADD COLUMN IF NOT EXISTS confirmation_count  INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS negative_count      INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trust_threshold     INTEGER DEFAULT 2,
    ADD COLUMN IF NOT EXISTS points_awarded      BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS points_pending      INTEGER DEFAULT 0
  `);
  console.log('[fase1] submitted_deals new columns added');

  // Migrate existing rows to 'submitted' status
  await query(`
    UPDATE submitted_deals SET status = 'submitted'
    WHERE status = 'pending'
  `);
  console.log('[fase1] migrated pending → submitted');

  // ── 3. submitted_deal_confirmations (separate from deal_confirmations) ────
  await query(`
    CREATE TABLE IF NOT EXISTS submitted_deal_confirmations (
      id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      submitted_deal_id  UUID NOT NULL REFERENCES submitted_deals(id) ON DELETE CASCADE,
      user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
      confirmation_type  VARCHAR(30) NOT NULL,
      price_seen         NUMERIC(10,2),
      notes              TEXT,
      created_at         TIMESTAMP DEFAULT NOW(),
      UNIQUE(submitted_deal_id, user_id),
      CHECK (confirmation_type IN (
        'price_confirmed', 'in_stock', 'out_of_stock', 'price_mismatch', 'not_found'
      ))
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_sdc_deal ON submitted_deal_confirmations(submitted_deal_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sdc_user ON submitted_deal_confirmations(user_id)`);
  // Ensure extended confirmation types are supported
  await query(`ALTER TABLE submitted_deal_confirmations DROP CONSTRAINT IF EXISTS submitted_deal_confirmations_confirmation_type_check`);
  await query(`
    ALTER TABLE submitted_deal_confirmations ADD CONSTRAINT submitted_deal_confirmations_confirmation_type_check
    CHECK (confirmation_type IN (
      'price_confirmed','in_stock','out_of_stock','price_mismatch','not_found',
      'wrong_product','expired','great_deal'
    ))
  `);
  console.log('[fase1] submitted_deal_confirmations table created');

  // ── 4. Trust score on collaborator_profiles ───────────────────────────────
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS submissions_today INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS last_submission_date DATE`);
  console.log('[fase1] collaborator_profiles trust columns added');

  // ── 5. contributor_wallets ────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS contributor_wallets (
      id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id           UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      points_pending    INTEGER DEFAULT 0,
      points_available  INTEGER DEFAULT 0,
      points_redeemed   INTEGER DEFAULT 0,
      credit_balance    NUMERIC(10,2) DEFAULT 0.00,
      lifetime_points   INTEGER DEFAULT 0,
      created_at        TIMESTAMP DEFAULT NOW(),
      updated_at        TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('[fase1] contributor_wallets created');

  // ── 6. contributor_earnings ───────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS contributor_earnings (
      id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_deal_id UUID REFERENCES submitted_deals(id) ON DELETE SET NULL,
      earning_type      VARCHAR(30) NOT NULL,
      points            INTEGER DEFAULT 0,
      credit_amount     NUMERIC(10,2) DEFAULT 0.00,
      status            VARCHAR(20) DEFAULT 'pending',
      description       TEXT,
      created_at        TIMESTAMP DEFAULT NOW(),
      CHECK (earning_type IN ('deal_verified', 'deal_official', 'high_roi_bonus', 'confirmation', 'referral_bonus')),
      CHECK (status IN ('pending', 'available', 'redeemed', 'expired'))
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_earnings_user ON contributor_earnings(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_earnings_deal ON contributor_earnings(submitted_deal_id)`);
  console.log('[fase1] contributor_earnings created');

  // ── 7. contributor_rewards ────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS contributor_rewards (
      id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reward_type      VARCHAR(30) NOT NULL,
      points_cost      INTEGER DEFAULT 0,
      value_description TEXT,
      status           VARCHAR(20) DEFAULT 'pending',
      redeemed_at      TIMESTAMP,
      expires_at       TIMESTAMP,
      created_at       TIMESTAMP DEFAULT NOW(),
      CHECK (reward_type IN ('pro_7_days', 'pro_1_month', 'credit_10', 'credit_25', 'pro_lifetime')),
      CHECK (status IN ('pending', 'active', 'used', 'expired'))
    )
  `);
  console.log('[fase1] contributor_rewards created');

  // ── 8. Anti-fraud: submission_rate_limits ─────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS submission_rate_limits (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      window_start TIMESTAMP NOT NULL DEFAULT NOW(),
      count       INTEGER DEFAULT 1,
      UNIQUE(user_id, window_start)
    )
  `);
  console.log('[fase1] submission_rate_limits created');

  // ── 9. store_locations: source column + unique lat/lng for Places dedup ───
  await query(`ALTER TABLE store_locations ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual'`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_store_locs_lat_lng_unique ON store_locations (latitude, longitude)`);
  console.log('[fase1] store_locations.source + unique lat/lng index added');

  console.log('[fase1] Migration complete ✓');
}

migrate()
  .catch(err => { console.error('[fase1] FAILED:', err.message); process.exit(1); })
  .then(() => process.exit(0));

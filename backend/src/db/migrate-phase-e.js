const { query } = require('../config/database');
const logger = require('../utils/logger');

async function migratePhaseE() {
  // ── collaborator_profiles: fraud + trust columns ──────────────────────────
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS fraud_score       INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS trust_level       VARCHAR(20) DEFAULT 'Normal'`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS device_hash       VARCHAR(64)`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS last_ip           VARCHAR(45)`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS last_gps_lat      DECIMAL(10,8)`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS last_gps_lng      DECIMAL(11,8)`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS duplicate_reports INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS verified_reports  INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS suspicious_activity BOOLEAN DEFAULT false`);

  // Backfill verified_reports from existing approved_deals_count
  await query(`
    UPDATE collaborator_profiles
    SET verified_reports = approved_deals_count,
        trust_level = CASE
          WHEN trust_score >= 85 THEN 'Excelente'
          WHEN trust_score >= 70 THEN 'Bueno'
          WHEN trust_score >= 50 THEN 'Normal'
          WHEN trust_score >= 30 THEN 'En observación'
          ELSE 'Suspendido'
        END,
        fraud_score = GREATEST(0, 100 - trust_score)
    WHERE verified_reports = 0 OR trust_level = 'Normal'
  `);

  // ── contributor_wallets: ensure table exists (may not exist on fresh DBs) ──
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
  await query(`CREATE INDEX IF NOT EXISTS idx_wallets_user ON contributor_wallets(user_id)`);

  // ── contributor_wallets: professional columns ─────────────────────────────
  await query(`ALTER TABLE contributor_wallets ADD COLUMN IF NOT EXISTS available_balance DECIMAL(10,2) DEFAULT 0`);
  await query(`ALTER TABLE contributor_wallets ADD COLUMN IF NOT EXISTS pending_balance   DECIMAL(10,2) DEFAULT 0`);
  await query(`ALTER TABLE contributor_wallets ADD COLUMN IF NOT EXISTS lifetime_earnings DECIMAL(10,2) DEFAULT 0`);
  await query(`ALTER TABLE contributor_wallets ADD COLUMN IF NOT EXISTS withdrawn_total   DECIMAL(10,2) DEFAULT 0`);
  await query(`ALTER TABLE contributor_wallets ADD COLUMN IF NOT EXISTS next_payout_date  DATE`);

  // Sync available_balance with existing credit_balance
  await query(`
    UPDATE contributor_wallets
    SET available_balance = COALESCE(credit_balance, 0),
        lifetime_earnings = COALESCE(credit_balance, 0)
    WHERE available_balance = 0 AND credit_balance > 0
  `);

  // ── payout_requests ───────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS payout_requests (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount         DECIMAL(10,2) NOT NULL,
      points_used    INTEGER NOT NULL DEFAULT 0,
      status         VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','paid')),
      payment_method VARCHAR(50),
      payment_detail VARCHAR(255),
      requested_at   TIMESTAMPTZ DEFAULT NOW(),
      approved_at    TIMESTAMPTZ,
      paid_at        TIMESTAMPTZ,
      admin_notes    TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_payouts_user   ON payout_requests(user_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_payouts_status ON payout_requests(status)`);

  // ── hunter_notifications ──────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS hunter_notifications (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       VARCHAR(50) NOT NULL,
      title      VARCHAR(200) NOT NULL,
      message    TEXT,
      metadata   JSONB,
      read       BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_notif_user   ON hunter_notifications(user_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notif_unread ON hunter_notifications(user_id, read) WHERE read = false`);

  logger.info('[migrate-phase-e] Phase E complete ✓');
}

module.exports = { migratePhaseE };

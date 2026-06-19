const { query } = require('../config/database');
const logger = require('../utils/logger');

const MISSIONS = [
  { slug: 'scan_5_daily',    title: 'Daily Scanner Run',          description: 'Scan 5 products today',                    type: 'daily',     action: 'scan_product',  target: 5,  xp: 30  },
  { slug: 'submit_1_daily',  title: 'Daily Deal Post',            description: 'Post 1 community deal today',              type: 'daily',     action: 'submit_deal',   target: 1,  xp: 25  },
  { slug: 'scan_20_weekly',  title: 'Scan 20 Products',           description: 'Use the scanner on 20 products this week', type: 'weekly',    action: 'scan_product',  target: 20, xp: 100 },
  { slug: 'submit_5_weekly', title: 'Post 5 Deals',               description: 'Submit 5 community deals this week',       type: 'weekly',    action: 'submit_deal',   target: 5,  xp: 150 },
  { slug: 'confirm_5_weekly','title': 'Confirm 5 Deals',          description: 'Confirm 5 deals posted by others',         type: 'weekly',    action: 'confirm_deal',  target: 5,  xp: 100 },
  { slug: 'roi_50_weekly',   title: 'High-ROI Find',              description: 'Submit a deal with ROI ≥ 50%',             type: 'weekly',    action: 'high_roi_deal', target: 1,  xp: 200 },
  { slug: 'refer_2_monthly', title: 'Invite 2 People',            description: 'Refer 2 new users who sign up',            type: 'monthly',   action: 'refer_user',    target: 2,  xp: 200 },
  { slug: 'submit_20_total', title: 'Community Contributor',      description: 'Submit 20 deals total (all time)',          type: 'permanent', action: 'submit_deal',   target: 20, xp: 500 },
  { slug: 'refer_5_total',   title: 'Team Builder',               description: 'Refer 5 active users (all time)',          type: 'permanent', action: 'refer_user',    target: 5,  xp: 750 },
];

async function migrateBusinessPhaseA() {
  // ── business_missions ──────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS business_missions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug         VARCHAR(80) UNIQUE NOT NULL,
      title        VARCHAR(200) NOT NULL,
      description  TEXT,
      type         VARCHAR(20) NOT NULL CHECK (type IN ('daily','weekly','monthly','permanent')),
      action       VARCHAR(60) NOT NULL,
      target       INTEGER NOT NULL DEFAULT 1,
      xp_reward    INTEGER NOT NULL DEFAULT 50,
      badge_reward VARCHAR(60),
      is_active    BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_missions_active ON business_missions(is_active, type)`);

  // ── business_mission_progress ──────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS business_mission_progress (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mission_id   UUID NOT NULL REFERENCES business_missions(id) ON DELETE CASCADE,
      progress     INTEGER DEFAULT 0,
      completed    BOOLEAN DEFAULT false,
      rewarded     BOOLEAN DEFAULT false,
      period       DATE NOT NULL DEFAULT CURRENT_DATE,
      completed_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, mission_id, period)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_missionprog_user   ON business_mission_progress(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_missionprog_period ON business_mission_progress(period)`);

  // ── hunter_badges ──────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS hunter_badges (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_slug VARCHAR(80) NOT NULL,
      badge_name VARCHAR(100) NOT NULL,
      awarded_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, badge_slug)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_badges_user ON hunter_badges(user_id)`);

  // ── collaborator_profiles: extra Business columns ─────────────────────────
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS scan_count     INTEGER DEFAULT 0`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS xp_this_month  INTEGER DEFAULT 0`);

  // ── Seed missions (idempotent) ─────────────────────────────────────────────
  for (const m of MISSIONS) {
    await query(`
      INSERT INTO business_missions (slug, title, description, type, action, target, xp_reward)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO NOTHING
    `, [m.slug, m.title, m.description, m.type, m.action, m.target, m.xp]);
  }

  // ── hunter_transactions (Phase B) ─────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS hunter_transactions (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type           VARCHAR(40) NOT NULL,
      source         VARCHAR(60),
      xp_delta       INTEGER NOT NULL DEFAULT 0,
      points_delta   INTEGER NOT NULL DEFAULT 0,
      amount_delta   NUMERIC(10,2) NOT NULL DEFAULT 0,
      status         VARCHAR(20) NOT NULL DEFAULT 'approved'
        CHECK (status IN ('pending','approved','rejected','paid','redeemed')),
      reference_type VARCHAR(40),
      reference_id   VARCHAR(200),
      description    TEXT,
      metadata       JSONB,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_htx_user    ON hunter_transactions(user_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_htx_type    ON hunter_transactions(type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_htx_status  ON hunter_transactions(status)`);

  // ── contributor_wallets: ensure points_pending exists ─────────────────────
  await query(`ALTER TABLE contributor_wallets ADD COLUMN IF NOT EXISTS points_pending INTEGER DEFAULT 0`);

  logger.info('[migrate-business] Phase A+B complete ✓');
}

module.exports = { migrateBusinessPhaseA };

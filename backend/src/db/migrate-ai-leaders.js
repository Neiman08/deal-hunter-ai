require('dotenv').config({ path: '../../.env' });
const { query } = require('../config/database');

async function migrateAiLeaders() {
  console.log('[ai-leaders] Running migration...');

  // ── Extend users table ──────────────────────────────────────────────────────
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ai_leader       BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_role            VARCHAR(100)`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_persona         VARCHAR(200)`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_specialty       TEXT`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_disclosure_label VARCHAR(50) DEFAULT 'AI Leader'`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url         VARCHAR(500)`);
  console.log('[ai-leaders] users columns OK');

  // ── Extend deal_posts ───────────────────────────────────────────────────────
  await query(`ALTER TABLE deal_posts ADD COLUMN IF NOT EXISTS is_ai_post    BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE deal_posts ADD COLUMN IF NOT EXISTS ai_leader_id  UUID REFERENCES users(id) ON DELETE SET NULL`);
  console.log('[ai-leaders] deal_posts columns OK');

  // ── Extend deal_post_comments ───────────────────────────────────────────────
  await query(`ALTER TABLE deal_post_comments ADD COLUMN IF NOT EXISTS is_ai_comment      BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE deal_post_comments ADD COLUMN IF NOT EXISTS ai_leader_id       UUID REFERENCES users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE deal_post_comments ADD COLUMN IF NOT EXISTS ai_commenter_name  VARCHAR(200)`);
  await query(`ALTER TABLE deal_post_comments ADD COLUMN IF NOT EXISTS ai_commenter_label VARCHAR(50)`);
  console.log('[ai-leaders] deal_post_comments columns OK');

  // ── AI leader settings (key-value store) ─────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS ai_leader_settings (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Default settings
  const defaults = [
    ['AI_LEADERS_ENABLED',        'true'],
    ['AI_AUTO_POSTS_ENABLED',     'true'],
    ['AI_AUTO_COMMENTS_ENABLED',  'true'],
    ['AI_MAX_COMMENTS_PER_DAY',   '20'],
    ['AI_MAX_POSTS_PER_DAY',      '10'],
  ];
  for (const [k, v] of defaults) {
    await query(`
      INSERT INTO ai_leader_settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
    `, [k, v]);
  }
  console.log('[ai-leaders] ai_leader_settings OK');

  console.log('[ai-leaders] Migration complete.');
}

module.exports = { migrateAiLeaders };

if (require.main === module) {
  migrateAiLeaders().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

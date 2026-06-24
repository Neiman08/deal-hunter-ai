const { query } = require('../config/database');

async function migrateAiLeadersV2() {
  // Seed new feature-flag settings (INSERT ... ON CONFLICT DO NOTHING keeps existing values)
  const defaults = [
    ['AI_DAILY_TIPS_ENABLED',    'true'],
    ['AI_RECOGNITION_ENABLED',   'true'],
    ['AI_WELCOME_ENABLED',       'true'],
    ['AI_TOP_HUNTERS_ENABLED',   'true'],
    ['AI_MISSION_OF_DAY_ENABLED','true'],
    ['AI_FAQ_ENABLED',           'true'],
  ];

  for (const [key, value] of defaults) {
    await query(
      `INSERT INTO ai_leader_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  // Also ensure ai_role is exposed on coach join (migrate-ai-leaders already adds it, but guard)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_role VARCHAR(100)`);

  console.log('[ai-leaders-v2] Migration complete.');
}

module.exports = { migrateAiLeadersV2 };

if (require.main === module) {
  migrateAiLeadersV2().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

const { query, pool } = require('../config/database');

async function migrate() {
  // Drop old constraint and recreate with beta allowed
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check`);
  await query(`
    ALTER TABLE users ADD CONSTRAINT users_plan_check
      CHECK (plan = ANY (ARRAY['free','pro','elite','beta']))
  `);
  console.log('[add-beta-plan] users.plan constraint updated');
  await pool.end();
}

migrate().catch(err => {
  console.error('[add-beta-plan] Error:', err.message);
  process.exit(1);
});

const { query } = require('../config/database');
const logger = require('../utils/logger');

async function migrateHallOfFame() {
  // Add city / state to collaborator_profiles so Hunters can set their home location
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS city  VARCHAR(100)`);
  await query(`ALTER TABLE collaborator_profiles ADD COLUMN IF NOT EXISTS state VARCHAR(10)`);

  // Indexes to speed up ranking queries
  await query(`CREATE INDEX IF NOT EXISTS idx_cp_hof_points ON collaborator_profiles(points DESC) WHERE is_active=true`);
  await query(`CREATE INDEX IF NOT EXISTS idx_cp_hof_xp_month ON collaborator_profiles(xp_this_month DESC) WHERE is_active=true`);
  await query(`CREATE INDEX IF NOT EXISTS idx_cp_city  ON collaborator_profiles(city)  WHERE city  IS NOT NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_cp_state ON collaborator_profiles(state) WHERE state IS NOT NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sd_city_status ON submitted_deals(city, status) WHERE city IS NOT NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_htx_week ON hunter_transactions(user_id, created_at DESC) WHERE status='approved'`);

  logger.info('[migrate-hall-of-fame] complete ✓');
}

module.exports = { migrateHallOfFame };

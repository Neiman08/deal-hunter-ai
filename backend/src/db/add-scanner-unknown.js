const { query } = require('../config/database');

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS scanner_unknown_products (
      id                 SERIAL PRIMARY KEY,
      upc                TEXT NOT NULL UNIQUE,
      scans_count        INTEGER NOT NULL DEFAULT 1,
      user_count         INTEGER NOT NULL DEFAULT 1,
      first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      store              TEXT,
      high_priority      BOOLEAN NOT NULL DEFAULT FALSE,
      recovery_attempted BOOLEAN NOT NULL DEFAULT FALSE,
      recovery_found     BOOLEAN NOT NULL DEFAULT FALSE,
      recovery_source    TEXT,
      recovery_data      JSONB,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_scanner_unknown_upc ON scanner_unknown_products(upc)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_scanner_unknown_priority ON scanner_unknown_products(high_priority, scans_count DESC)`);

  console.log('[Migration] scanner_unknown_products table ready');
}

migrate()
  .catch(err => { console.error('[Migration] error:', err.message); process.exit(1); })
  .then(() => process.exit(0));

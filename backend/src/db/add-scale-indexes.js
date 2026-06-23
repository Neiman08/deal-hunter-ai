/**
 * Scale optimization: add indexes that become important at 1000+ concurrent users.
 * All statements use IF NOT EXISTS so they are safe to run multiple times.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { query } = require('../config/database');

async function migrate() {
  const indexes = [
    // Partial index covering every public-feed query:
    // WHERE is_public_visible = true AND quality_status IN ('PASS', 'NEEDS_IMAGE')
    // Also includes store_id so per-store queries stay within this index.
    `CREATE INDEX IF NOT EXISTS idx_products_public_feed
       ON products (quality_status, store_id)
       WHERE is_public_visible = true`,

    // Deals: product_id lookup is on the hot JOIN path for every deal query.
    // The unique constraint already creates an index on (product_id, store_id),
    // but a standalone product_id index speeds up the JOIN when store_id is not in the WHERE.
    `CREATE INDEX IF NOT EXISTS idx_deals_product_id
       ON deals (product_id)
       WHERE is_active = true`,

    // last_seen_at is queried for freshness filter across all active deals.
    `CREATE INDEX IF NOT EXISTS idx_deals_active_last_seen
       ON deals (last_seen_at DESC)
       WHERE is_active = true`,
  ];

  for (const sql of indexes) {
    const name = (sql.match(/INDEX IF NOT EXISTS (\S+)/) || [])[1] || '?';
    try {
      await query(sql);
      console.log(`[add-scale-indexes] ✅ ${name}`);
    } catch (err) {
      console.warn(`[add-scale-indexes] ⚠️  ${name}: ${err.message}`);
    }
  }

  console.log('[add-scale-indexes] Done');
}

migrate()
  .catch(err => { console.error('[add-scale-indexes] ERROR:', err.message); process.exit(1); })
  .then(() => process.exit(0));

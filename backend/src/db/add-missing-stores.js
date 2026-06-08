require('dotenv').config();
const { pool } = require('../config/database');

const MISSING_STORES = [
  { name: 'GameStop',       slug: 'gamestop',       color: '#5D1DB6', website_url: 'https://www.gamestop.com' },
  { name: 'Office Depot',   slug: 'office-depot',   color: '#C8102E', website_url: 'https://www.officedepot.com' },
  { name: 'Staples',        slug: 'staples',         color: '#CC0000', website_url: 'https://www.staples.com' },
  { name: "Kohl's",         slug: 'kohls',           color: '#CC0000', website_url: 'https://www.kohls.com' },
  { name: 'Nordstrom Rack', slug: 'nordstrom-rack',  color: '#001E5B', website_url: 'https://www.nordstromrack.com' },
  { name: 'TJ Maxx',        slug: 'tj-maxx',         color: '#E31837', website_url: 'https://www.tjmaxx.tjx.com' },
  { name: 'Marshalls',      slug: 'marshalls',       color: '#C41230', website_url: 'https://www.marshalls.com' },
  { name: 'Burlington',     slug: 'burlington',      color: '#E31837', website_url: 'https://www.burlington.com' },
  { name: 'Costco',         slug: 'costco',          color: '#005DAA', website_url: 'https://www.costco.com' },
];

async function run() {
  const client = await pool.connect();
  let added = 0, updated = 0, failed = 0;
  try {
    // Log stores table columns so we can detect schema mismatches
    try {
      const cols = await client.query(`
        SELECT column_name, data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = 'stores' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);
      console.log('  stores columns:', cols.rows.map(c => c.column_name).join(', '));
    } catch (e) {
      console.log('  (could not read schema:', e.message, ')');
    }

    for (const s of MISSING_STORES) {
      try {
        // Primary insert with all columns
        const r = await client.query(
          `INSERT INTO stores (name, slug, color, website_url, is_active, scraping_enabled)
           VALUES ($1,$2,$3,$4,true,true)
           ON CONFLICT (slug) DO UPDATE SET
             name             = EXCLUDED.name,
             website_url      = EXCLUDED.website_url,
             is_active        = true,
             scraping_enabled = true
           RETURNING id, slug`,
          [s.name, s.slug, s.color, s.website_url]
        );
        if (r.rowCount > 0) {
          console.log(`  ✅ Upserted: ${s.slug} (id=${r.rows[0].id})`);
          added++;
        } else {
          console.log(`  ⚠️  No rows returned for: ${s.slug}`);
          failed++;
        }
      } catch (err) {
        console.error(`  ❌ Failed:  ${s.slug}`);
        console.error(`     code: ${err.code} | detail: ${err.detail || ''}`);
        console.error(`     msg:  ${err.message}`);
        // Fallback: try without scraping_enabled in case column missing
        try {
          const r2 = await client.query(
            `INSERT INTO stores (name, slug, color, website_url, is_active)
             VALUES ($1,$2,$3,$4,true)
             ON CONFLICT (slug) DO UPDATE SET
               name=EXCLUDED.name, website_url=EXCLUDED.website_url, is_active=true
             RETURNING id, slug`,
            [s.name, s.slug, s.color, s.website_url]
          );
          if (r2.rowCount > 0) {
            console.log(`  ✅ Fallback OK: ${s.slug} (id=${r2.rows[0].id})`);
            added++;
          }
        } catch (err2) {
          console.error(`  ❌ Fallback also failed: ${s.slug} — ${err2.message}`);
          failed++;
        }
      }
    }

    // Verify Burlington specifically
    const check = await client.query(`SELECT id, slug, is_active FROM stores WHERE slug = 'burlington'`);
    if (check.rows.length > 0) {
      console.log(`\n  ✅ Burlington confirmed in DB: id=${check.rows[0].id} is_active=${check.rows[0].is_active}`);
    } else {
      console.log('\n  ❌ Burlington still NOT in DB after migration');
    }

    const total = await client.query(`SELECT COUNT(*) AS n FROM stores`);
    console.log(`\n✅ Store migration done — added:${added} updated:${updated} failed:${failed} | total stores in DB: ${total.rows[0].n}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

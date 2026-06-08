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
  try {
    let added = 0;
    for (const s of MISSING_STORES) {
      const r = await client.query(
        `INSERT INTO stores (name, slug, color, website_url, is_active, scraping_enabled)
         VALUES ($1,$2,$3,$4,true,true)
         ON CONFLICT (slug) DO NOTHING
         RETURNING slug`,
        [s.name, s.slug, s.color, s.website_url]
      );
      if (r.rowCount > 0) {
        console.log(`  ✅ Added store: ${s.slug}`);
        added++;
      } else {
        console.log(`  ✓  Store already exists: ${s.slug}`);
      }
    }
    console.log(`\n✅ Store migration complete — ${added} added, ${MISSING_STORES.length - added} already present`);
  } catch (err) {
    console.error('⚠️  Store migration warning (non-fatal):', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

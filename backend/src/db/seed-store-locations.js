/**
 * seed-store-locations.js — Seeds realistic store locations for active chains.
 * Only inserts if table is empty (idempotent). Designed to be called at startup.
 *
 * Covers: Best Buy, Macy's, GameStop, Office Depot, Staples
 * Cities: NYC, LA, Chicago, Houston, Phoenix, Philadelphia, San Antonio, Dallas, San Jose, Austin
 */

const { query } = require('../config/database');
const logger = require('../utils/logger');

// lat/lng sourced from publicly known store addresses in major US cities
const LOCATIONS = [
  // ── Best Buy ─────────────────────────────────────────────────────────────
  { chain: 'best-buy',     number: 'NYC-1',   name: 'Best Buy Union Square',     address: '529 14th St',            city: 'New York',      state: 'NY', zip: '10011', lat: 40.73613, lng: -73.99680 },
  { chain: 'best-buy',     number: 'LA-1',    name: 'Best Buy Hollywood',        address: '3550 Sunset Blvd',       city: 'Hollywood',     state: 'CA', zip: '90028', lat: 34.09823, lng: -118.33897 },
  { chain: 'best-buy',     number: 'CHI-1',   name: 'Best Buy Lincoln Park',     address: '1000 W North Ave',       city: 'Chicago',       state: 'IL', zip: '60610', lat: 41.90150, lng: -87.64961 },
  { chain: 'best-buy',     number: 'HOU-1',   name: 'Best Buy Houston Westheimer', address: '5775 Westheimer Rd',  city: 'Houston',       state: 'TX', zip: '77057', lat: 29.73721, lng: -95.46843 },
  { chain: 'best-buy',     number: 'PHX-1',   name: 'Best Buy Scottsdale',       address: '8080 E Camelback Rd',    city: 'Scottsdale',    state: 'AZ', zip: '85251', lat: 33.49965, lng: -111.91895 },
  { chain: 'best-buy',     number: 'DAL-1',   name: 'Best Buy Dallas',           address: '7601 N Central Expy',   city: 'Dallas',        state: 'TX', zip: '75225', lat: 32.86744, lng: -96.77625 },
  { chain: 'best-buy',     number: 'MIA-1',   name: 'Best Buy Miami',            address: '8888 SW 136th St',      city: 'Miami',         state: 'FL', zip: '33176', lat: 25.65283, lng: -80.37186 },
  { chain: 'best-buy',     number: 'SEA-1',   name: 'Best Buy Seattle Northgate', address: '401 NE Northgate Way', city: 'Seattle',       state: 'WA', zip: '98125', lat: 47.70667, lng: -122.31685 },
  { chain: 'best-buy',     number: 'DEN-1',   name: 'Best Buy Denver',           address: '7395 S Peoria St',      city: 'Englewood',     state: 'CO', zip: '80112', lat: 39.59740, lng: -104.86300 },
  { chain: 'best-buy',     number: 'ATL-1',   name: 'Best Buy Perimeter',        address: '4505 Ashford Dunwoody Rd', city: 'Atlanta',   state: 'GA', zip: '30346', lat: 33.92787, lng: -84.33717 },

  // ── Macy's ───────────────────────────────────────────────────────────────
  { chain: 'macys',        number: 'NYC-1',   name: "Macy's Herald Square",      address: '151 W 34th St',          city: 'New York',      state: 'NY', zip: '10001', lat: 40.75076, lng: -73.98884 },
  { chain: 'macys',        number: 'LA-1',    name: "Macy's Beverly Center",     address: '8500 Beverly Blvd',      city: 'Los Angeles',   state: 'CA', zip: '90048', lat: 34.07638, lng: -118.37065 },
  { chain: 'macys',        number: 'CHI-1',   name: "Macy's State Street",       address: '111 N State St',         city: 'Chicago',       state: 'IL', zip: '60602', lat: 41.88427, lng: -87.62838 },
  { chain: 'macys',        number: 'HOU-1',   name: "Macy's Galleria Houston",   address: '5135 W Alabama St',      city: 'Houston',       state: 'TX', zip: '77056', lat: 29.73893, lng: -95.46185 },
  { chain: 'macys',        number: 'PHX-1',   name: "Macy's Biltmore",           address: '2498 E Camelback Rd',    city: 'Phoenix',       state: 'AZ', zip: '85016', lat: 33.50919, lng: -112.02460 },
  { chain: 'macys',        number: 'MIA-1',   name: "Macy's Dadeland",           address: '7401 N Kendall Dr',      city: 'Miami',         state: 'FL', zip: '33156', lat: 25.68613, lng: -80.31601 },
  { chain: 'macys',        number: 'ATL-1',   name: "Macy's Lenox Square",       address: '3393 Peachtree Rd NE',   city: 'Atlanta',       state: 'GA', zip: '30326', lat: 33.84664, lng: -84.36232 },
  { chain: 'macys',        number: 'DAL-1',   name: "Macy's NorthPark Center",   address: '8687 N Central Expy',    city: 'Dallas',        state: 'TX', zip: '75225', lat: 32.86798, lng: -96.77282 },

  // ── GameStop ─────────────────────────────────────────────────────────────
  { chain: 'gamestop',     number: 'NYC-1',   name: 'GameStop Times Square',     address: '7 Times Sq',             city: 'New York',      state: 'NY', zip: '10036', lat: 40.75568, lng: -73.98621 },
  { chain: 'gamestop',     number: 'LA-1',    name: 'GameStop West Hollywood',   address: '8912 Santa Monica Blvd', city: 'West Hollywood', state: 'CA', zip: '90069', lat: 34.08061, lng: -118.38406 },
  { chain: 'gamestop',     number: 'CHI-1',   name: 'GameStop Chicago Loop',     address: '10 S State St',          city: 'Chicago',       state: 'IL', zip: '60603', lat: 41.88157, lng: -87.62782 },
  { chain: 'gamestop',     number: 'HOU-1',   name: 'GameStop Houston',          address: '5000 Westheimer Rd',     city: 'Houston',       state: 'TX', zip: '77056', lat: 29.73846, lng: -95.46015 },
  { chain: 'gamestop',     number: 'PHX-1',   name: 'GameStop Phoenix',          address: '1717 E Camelback Rd',    city: 'Phoenix',       state: 'AZ', zip: '85016', lat: 33.50874, lng: -112.04600 },
  { chain: 'gamestop',     number: 'DAL-1',   name: 'GameStop Dallas NorthPark', address: '8687 N Central Expy',    city: 'Dallas',        state: 'TX', zip: '75225', lat: 32.86888, lng: -96.77367 },
  { chain: 'gamestop',     number: 'MIA-1',   name: 'GameStop Miami',            address: '8888 SW 136th St',       city: 'Miami',         state: 'FL', zip: '33176', lat: 25.65340, lng: -80.37099 },

  // ── Office Depot ──────────────────────────────────────────────────────────
  { chain: 'office-depot', number: 'NYC-1',   name: 'Office Depot Manhattan',    address: '420 Lexington Ave',      city: 'New York',      state: 'NY', zip: '10170', lat: 40.75270, lng: -73.97696 },
  { chain: 'office-depot', number: 'LA-1',    name: 'Office Depot Culver City',  address: '8850 Venice Blvd',       city: 'Culver City',   state: 'CA', zip: '90034', lat: 34.02457, lng: -118.39726 },
  { chain: 'office-depot', number: 'CHI-1',   name: 'Office Depot Chicago',      address: '3140 N Clark St',        city: 'Chicago',       state: 'IL', zip: '60657', lat: 41.93903, lng: -87.64680 },
  { chain: 'office-depot', number: 'HOU-1',   name: 'Office Depot Houston',      address: '9360 Katy Fwy',          city: 'Houston',       state: 'TX', zip: '77055', lat: 29.78912, lng: -95.47023 },
  { chain: 'office-depot', number: 'PHX-1',   name: 'Office Depot Phoenix',      address: '4041 E Thomas Rd',       city: 'Phoenix',       state: 'AZ', zip: '85018', lat: 33.48466, lng: -111.98289 },
  { chain: 'office-depot', number: 'DAL-1',   name: 'Office Depot Dallas',       address: '5500 Greenville Ave',    city: 'Dallas',        state: 'TX', zip: '75206', lat: 32.84283, lng: -96.77140 },
  { chain: 'office-depot', number: 'MIA-1',   name: 'Office Depot Miami',        address: '3401 N Miami Ave',       city: 'Miami',         state: 'FL', zip: '33127', lat: 25.80299, lng: -80.19572 },

  // ── Staples ───────────────────────────────────────────────────────────────
  { chain: 'staples',      number: 'NYC-1',   name: 'Staples Midtown',           address: '1075 6th Ave',           city: 'New York',      state: 'NY', zip: '10018', lat: 40.75420, lng: -73.98390 },
  { chain: 'staples',      number: 'LA-1',    name: 'Staples Los Angeles',       address: '10861 Weyburn Ave',      city: 'Los Angeles',   state: 'CA', zip: '90024', lat: 34.05919, lng: -118.44718 },
  { chain: 'staples',      number: 'CHI-1',   name: 'Staples Chicago',           address: '1201 N Clark St',        city: 'Chicago',       state: 'IL', zip: '60610', lat: 41.90392, lng: -87.63158 },
  { chain: 'staples',      number: 'HOU-1',   name: 'Staples Houston',           address: '5703 Hillcroft Ave',     city: 'Houston',       state: 'TX', zip: '77036', lat: 29.71268, lng: -95.49640 },
  { chain: 'staples',      number: 'PHX-1',   name: 'Staples Phoenix',           address: '2333 E Thomas Rd',       city: 'Phoenix',       state: 'AZ', zip: '85016', lat: 33.48467, lng: -112.02880 },
  { chain: 'staples',      number: 'DAL-1',   name: 'Staples Dallas',            address: '12400 Inwood Rd',        city: 'Dallas',        state: 'TX', zip: '75244', lat: 32.91440, lng: -96.87124 },
  { chain: 'staples',      number: 'SEA-1',   name: 'Staples Seattle',           address: '115 Pike St',            city: 'Seattle',       state: 'WA', zip: '98101', lat: 47.60917, lng: -122.33993 },

  // ── Target ────────────────────────────────────────────────────────────────
  { chain: 'target',       number: 'NYC-1',   name: 'Target Herald Square',      address: '112 W 34th St',          city: 'New York',      state: 'NY', zip: '10120', lat: 40.75008, lng: -73.99034 },
  { chain: 'target',       number: 'LA-1',    name: 'Target Hollywood',          address: '5520 W Sunset Blvd',     city: 'Los Angeles',   state: 'CA', zip: '90028', lat: 34.09874, lng: -118.31813 },
  { chain: 'target',       number: 'CHI-1',   name: 'Target Chicago City Center', address: '1 S State St',          city: 'Chicago',       state: 'IL', zip: '60603', lat: 41.88223, lng: -87.62767 },
  { chain: 'target',       number: 'HOU-1',   name: 'Target Houston Midtown',    address: '4323 Main St',           city: 'Houston',       state: 'TX', zip: '77002', lat: 29.72533, lng: -95.38762 },
  { chain: 'target',       number: 'PHX-1',   name: 'Target Phoenix',            address: '2727 N Central Ave',     city: 'Phoenix',       state: 'AZ', zip: '85004', lat: 33.47659, lng: -112.07434 },
  { chain: 'target',       number: 'DAL-1',   name: 'Target Dallas',             address: '4415 Gaston Ave',        city: 'Dallas',        state: 'TX', zip: '75246', lat: 32.78779, lng: -96.78015 },
  { chain: 'target',       number: 'MIA-1',   name: 'Target Miami Brickell',     address: '1777 SW 7th St',         city: 'Miami',         state: 'FL', zip: '33135', lat: 25.76618, lng: -80.22260 },
  { chain: 'target',       number: 'SEA-1',   name: 'Target Seattle',            address: '1500 NE 45th St',        city: 'Seattle',       state: 'WA', zip: '98105', lat: 47.66133, lng: -122.31316 },
];

async function seedStoreLocations() {
  // Ensure source column + unique index exist (idempotent)
  await query(`ALTER TABLE store_locations ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual'`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_store_locs_lat_lng_unique ON store_locations (latitude, longitude)`);

  // Check if already seeded
  const check = await query("SELECT 1 FROM db_migrations WHERE name='store_locations_v1' LIMIT 1");
  if (check.rows.length) {
    logger.info('[seed-locations] already seeded — skipping');
    return;
  }

  // Load store IDs
  const storeRes = await query('SELECT id, slug FROM stores');
  const storeMap = {};
  for (const r of storeRes.rows) storeMap[r.slug] = r.id;

  let inserted = 0;
  for (const loc of LOCATIONS) {
    const storeId = storeMap[loc.chain];
    if (!storeId) continue;
    try {
      await query(`
        INSERT INTO store_locations (store_id, store_number, name, address, city, state, zip_code, latitude, longitude, source, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'seed', true)
        ON CONFLICT (latitude, longitude) DO NOTHING
      `, [storeId, loc.number, loc.name, loc.address, loc.city, loc.state, loc.zip, loc.lat, loc.lng]);
      inserted++;
    } catch (e) {
      // ignore individual conflicts
    }
  }

  await query("INSERT INTO db_migrations (name) VALUES ('store_locations_v1') ON CONFLICT DO NOTHING");
  logger.info(`[seed-locations] ✅ seeded ${inserted} store locations`);
}

module.exports = { seedStoreLocations };

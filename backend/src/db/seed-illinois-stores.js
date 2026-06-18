require('dotenv').config();
const { pool } = require('../config/database');

// Physical store locations near Palatine / Schaumburg / Arlington Heights IL
// store_locations has no metadata/source column — seed_mobile_test purpose noted here only
const IL_STORES = [
  // Best Buy
  { store_id: '4a610a59-a4ae-4bdc-9222-54288e7d59c6', store_number: 'BB-148', address: '100 E Golf Rd',         city: 'Schaumburg',       state: 'IL', zip_code: '60173', latitude: 42.0368, longitude: -88.0536 },
  { store_id: '4a610a59-a4ae-4bdc-9222-54288e7d59c6', store_number: 'BB-292', address: '1850 W Algonquin Rd',  city: 'Arlington Heights', state: 'IL', zip_code: '60004', latitude: 42.0729, longitude: -88.0958 },
  { store_id: '4a610a59-a4ae-4bdc-9222-54288e7d59c6', store_number: 'BB-411', address: '220 N Milwaukee Ave',   city: 'Buffalo Grove',    state: 'IL', zip_code: '60089', latitude: 42.1499, longitude: -87.9700 },
  // Target
  { store_id: 'e41add2a-4d0a-45af-8c2f-f7283313ceed', store_number: 'T-2150', address: '1100 N Rand Rd',        city: 'Palatine',         state: 'IL', zip_code: '60074', latitude: 42.1170, longitude: -88.0447 },
  { store_id: 'e41add2a-4d0a-45af-8c2f-f7283313ceed', store_number: 'T-2151', address: '1500 E Higgins Rd',     city: 'Schaumburg',       state: 'IL', zip_code: '60173', latitude: 42.0167, longitude: -88.0501 },
  { store_id: 'e41add2a-4d0a-45af-8c2f-f7283313ceed', store_number: 'T-2152', address: '201 W Rand Rd',         city: 'Arlington Heights', state: 'IL', zip_code: '60004', latitude: 42.0829, longitude: -88.0501 },
  // Macy's
  { store_id: '225d28e2-d18a-4b89-b02d-3c1eabdde344', store_number: 'M-0081', address: '5 Woodfield Mall',      city: 'Schaumburg',       state: 'IL', zip_code: '60173', latitude: 42.0282, longitude: -88.0735 },
  { store_id: '225d28e2-d18a-4b89-b02d-3c1eabdde344', store_number: 'M-0044', address: '999 Randhurst Village Dr', city: 'Mount Prospect', state: 'IL', zip_code: '60056', latitude: 42.0769, longitude: -87.9700 },
  // GameStop
  { store_id: '61fae100-ed3c-42f3-9c45-8270ce5a0b65', store_number: 'GS-4112', address: '1 N Northwest Hwy',    city: 'Palatine',         state: 'IL', zip_code: '60067', latitude: 42.1153, longitude: -88.0340 },
  { store_id: '61fae100-ed3c-42f3-9c45-8270ce5a0b65', store_number: 'GS-4201', address: '1 Woodfield Mall',     city: 'Schaumburg',       state: 'IL', zip_code: '60173', latitude: 42.0285, longitude: -88.0730 },
  { store_id: '61fae100-ed3c-42f3-9c45-8270ce5a0b65', store_number: 'GS-4356', address: '2200 Barrington Rd',   city: 'Hoffman Estates',  state: 'IL', zip_code: '60169', latitude: 42.0502, longitude: -88.1199 },
  // Staples
  { store_id: '7fa45f0a-a324-454f-b1d1-9c550a68aa29', store_number: 'ST-1842', address: '1450 E Golf Rd',        city: 'Schaumburg',       state: 'IL', zip_code: '60173', latitude: 42.0370, longitude: -88.0520 },
  { store_id: '7fa45f0a-a324-454f-b1d1-9c550a68aa29', store_number: 'ST-1756', address: '1219 Lake Cook Rd',     city: 'Buffalo Grove',    state: 'IL', zip_code: '60089', latitude: 42.1574, longitude: -87.9694 },
  { store_id: '7fa45f0a-a324-454f-b1d1-9c550a68aa29', store_number: 'ST-0983', address: '33 W Rand Rd',          city: 'Arlington Heights', state: 'IL', zip_code: '60004', latitude: 42.0867, longitude: -88.0583 },
  // Office Depot
  { store_id: 'be52aa0c-4307-4722-81e5-640636ee59dd', store_number: 'OD-6242', address: '1144 E Dundee Rd',      city: 'Palatine',         state: 'IL', zip_code: '60074', latitude: 42.1274, longitude: -87.9906 },
  { store_id: 'be52aa0c-4307-4722-81e5-640636ee59dd', store_number: 'OD-6189', address: '1350 E Golf Rd',        city: 'Schaumburg',       state: 'IL', zip_code: '60173', latitude: 42.0354, longitude: -88.0502 },
];

async function seedIllinoisStores() {
  const client = await pool.connect();
  let inserted = 0, skipped = 0;
  try {
    for (const s of IL_STORES) {
      const exists = await client.query(
        'SELECT id FROM store_locations WHERE store_id = $1 AND address = $2 AND city = $3',
        [s.store_id, s.address, s.city]
      );
      if (exists.rows.length > 0) {
        skipped++;
        continue;
      }
      await client.query(
        `INSERT INTO store_locations
           (store_id, store_number, address, city, state, zip_code, latitude, longitude, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [s.store_id, s.store_number, s.address, s.city, s.state, s.zip_code, s.latitude, s.longitude]
      );
      console.log(`  ✅ Inserted: ${s.address}, ${s.city} IL`);
      inserted++;
    }
    console.log(`[seed-illinois-stores] Done — inserted: ${inserted}, skipped: ${skipped}`);
  } catch (err) {
    console.error('[seed-illinois-stores] Error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = seedIllinoisStores;

if (require.main === module) {
  seedIllinoisStores().then(() => process.exit(0)).catch(() => process.exit(1));
}

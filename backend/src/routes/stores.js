const express = require('express');
const https = require('https');
const { query } = require('../config/database');

const router = express.Router();

const STORE_BRANDS = [
  'Best Buy', 'Target', 'Walmart', "Lowe's", 'Home Depot',
  'GameStop', 'Staples', 'Office Depot', 'Costco', "Macy's",
];

function googlePlacesRequest(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: 'maps.googleapis.com', path, timeout: 10000 }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// GET /api/stores
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*,
        COUNT(d.id) FILTER (WHERE d.is_active = true AND p.is_public_visible = true AND p.quality_status IN ('PASS','NEEDS_IMAGE')) AS active_deals,
        AVG(d.discount_percent) FILTER (WHERE d.is_active = true AND p.is_public_visible = true AND p.quality_status IN ('PASS','NEEDS_IMAGE')) AS avg_discount
      FROM stores s
      LEFT JOIN deals d ON d.store_id = s.id
      LEFT JOIN products p ON d.product_id = p.id
      WHERE s.is_active = true
      GROUP BY s.id
      ORDER BY active_deals DESC
    `);
    res.json({ stores: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// GET /api/stores/map?lat=42.11&lng=-88.03&radius=25  OR  ?zip=60074&radius=25
router.get('/map', async (req, res) => {
  try {
    const { zip, lat, lng, radius = 25 } = req.query;

    // Require at least one search parameter — never return random stores
    if (!lat && !lng && !zip) {
      return res.json({ locations: [] });
    }

    const params = [];
    let distanceExpr = 'NULL';
    let distanceFilter = '';
    let orderBy = 'deal_count DESC';
    let idx = 1;

    if (lat && lng) {
      const latF = parseFloat(lat);
      const lngF = parseFloat(lng);
      const radF = parseFloat(radius);
      if (isNaN(latF) || isNaN(lngF) || isNaN(radF)) {
        return res.status(400).json({ error: 'Invalid lat/lng/radius' });
      }
      // Haversine in km, converted to miles
      const haversine = `(6371 * acos(GREATEST(-1, LEAST(1,
        cos(radians($${idx})) * cos(radians(sl.latitude::float)) *
        cos(radians(sl.longitude::float) - radians($${idx + 1})) +
        sin(radians($${idx})) * sin(radians(sl.latitude::float))
      ))) * 0.621371)`;
      params.push(latF, lngF, radF);
      distanceExpr = `ROUND(${haversine}::numeric, 1)`;
      distanceFilter = `AND ${haversine} <= $${idx + 2}`;
      orderBy = 'distance_miles ASC NULLS LAST';
      idx += 3;
    }

    if (zip) {
      params.push(`${zip.substring(0, 3)}%`);
    }

    const sql = `
      SELECT
        sl.id, sl.store_number, sl.name, sl.address, sl.city, sl.state,
        sl.zip_code, sl.latitude, sl.longitude, sl.phone,
        s.name AS store_chain, s.slug AS store_slug, s.color AS store_color,
        s.logo_url,
        ${distanceExpr} AS distance_miles,
        COUNT(d.id) AS deal_count,
        MAX(d.opportunity_score) AS best_score,
        MIN(d.deal_price) AS lowest_price,
        MAX(d.discount_percent) AS max_discount,
        MAX(d.estimated_profit) AS best_profit
      FROM store_locations sl
      JOIN stores s ON sl.store_id = s.id
      LEFT JOIN deals d ON d.store_id = s.id AND d.is_active = true
      WHERE sl.is_active = true AND sl.latitude IS NOT NULL
        ${distanceFilter}
        ${zip ? `AND sl.zip_code LIKE $${idx}` : ''}
      GROUP BY sl.id, s.id
      ORDER BY ${orderBy}
      LIMIT 50
    `;

    const result = await query(sql, params);
    let locations = result.rows;

    // ── Auto-discovery via Google Places when no DB locations found ───────
    if (locations.length === 0 && lat && lng && process.env.GOOGLE_MAPS_API_KEY) {
      const discovered = await discoverAndSaveStores(parseFloat(lat), parseFloat(lng), parseFloat(radius));
      if (discovered.length > 0) {
        // Re-query DB now that stores are saved
        const reQuery = await query(sql, params);
        locations = reQuery.rows;
        // If still empty (no deals yet), return raw discovered list with flag
        if (locations.length === 0) {
          return res.json({ locations: [], discovered, no_deals_yet: true });
        }
      }
    }

    res.json({ locations });
  } catch (err) {
    console.error('stores/map error:', err);
    res.status(500).json({ error: 'Failed to fetch store map' });
  }
});

async function discoverAndSaveStores(lat, lng, radiusMiles) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const radiusMeters = Math.min(Math.round(radiusMiles * 1609.34), 50000);
  const saved = [];

  // Get store_id map: slug → id
  const storeRows = await query('SELECT id, name, slug FROM stores WHERE is_active = true');
  const storeMap = {};
  for (const s of storeRows.rows) {
    storeMap[s.name.toLowerCase()] = s;
    storeMap[s.slug.toLowerCase()] = s;
  }

  for (const brand of STORE_BRANDS) {
    const keyword = encodeURIComponent(brand);
    const path = `/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${keyword}&type=store&key=${apiKey}`;

    let data;
    try { data = await googlePlacesRequest(path); } catch { continue; }
    if (!['OK', 'ZERO_RESULTS'].includes(data.status)) continue;

    for (const place of (data.results || []).slice(0, 5)) {
      const pName = (place.name || '').toLowerCase();
      const matchedStore = Object.values(storeMap).find(s =>
        pName.includes(s.name.toLowerCase()) || pName.includes(s.slug.toLowerCase())
      );
      if (!matchedStore) continue;

      const plat = place.geometry?.location?.lat;
      const plng = place.geometry?.location?.lng;
      if (!plat || !plng) continue;

      // Upsert by place_id or coordinates
      try {
        const vicinity  = place.vicinity || '';
        const cityParts = vicinity.split(',');
        const city = cityParts.length > 1 ? cityParts[cityParts.length - 2].trim() : cityParts[0].trim() || 'Unknown';

        const ins = await query(`
          INSERT INTO store_locations (
            store_id, name, address, city, state, zip_code,
            latitude, longitude, is_active, source
          )
          VALUES ($1, $2, $3, $4, '', '', $5, $6, true, 'google_places')
          ON CONFLICT (latitude, longitude) DO NOTHING
          RETURNING id, name, address, latitude, longitude
        `, [
          matchedStore.id,
          place.name,
          vicinity,
          city,
          plat, plng,
        ]);
        if (ins.rows[0]) saved.push({ ...ins.rows[0], store_chain: matchedStore.name, store_slug: matchedStore.slug });
      } catch (e) {
        console.warn(`[Places] insert failed for ${place.name}:`, e.message);
      }
    }
  }

  console.log(`[Places] discovered and saved ${saved.length} new store locations near ${lat},${lng}`);
  return saved;
}

// GET /api/stores/nearby?lat=41.88&lng=-87.63&radius=24140
// radius in meters (default 24140 = 15 miles). Requires GOOGLE_MAPS_API_KEY.
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 24140 } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng required' });
    }

    if (!apiKey) {
      return res.status(503).json({
        error: 'Google Maps API key not configured',
        hint: 'Set GOOGLE_MAPS_API_KEY in backend .env',
        stores: [],
      });
    }

    const allStores = [];

    for (const brand of STORE_BRANDS) {
      const keyword = encodeURIComponent(brand);
      const path = `/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${keyword}&type=store&key=${apiKey}`;

      try {
        const data = await googlePlacesRequest(path);
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.warn(`Places API ${data.status} for ${brand}`);
          continue;
        }

        for (const place of (data.results || []).slice(0, 3)) {
          const name = place.name || brand;
          if (!STORE_BRANDS.some(b => name.toLowerCase().includes(b.toLowerCase()))) continue;

          allStores.push({
            place_id: place.place_id,
            name: place.name,
            brand,
            address: place.vicinity,
            lat: place.geometry?.location?.lat,
            lng: place.geometry?.location?.lng,
            rating: place.rating || null,
            open_now: place.opening_hours?.open_now ?? null,
          });
        }
      } catch (err) {
        console.warn(`Places lookup failed for ${brand}:`, err.message);
      }
    }

    // Dedupe by place_id
    const seen = new Set();
    const unique = allStores.filter(s => {
      if (seen.has(s.place_id)) return false;
      seen.add(s.place_id);
      return true;
    });

    res.json({ stores: unique, lat: parseFloat(lat), lng: parseFloat(lng) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch nearby stores', stores: [] });
  }
});

// GET /api/stores/:slug
router.get('/:slug', async (req, res) => {
  try {
    const storeResult = await query(
      'SELECT * FROM stores WHERE slug = $1',
      [req.params.slug]
    );

    if (!storeResult.rows[0]) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const store = storeResult.rows[0];

    const deals = await query(`
      SELECT d.*, p.name AS product_name, p.image_url
      FROM deals d JOIN products p ON d.product_id = p.id
      WHERE d.store_id = $1 AND d.is_active = true
        AND p.is_public_visible = true AND p.quality_status IN ('PASS', 'NEEDS_IMAGE')
      ORDER BY d.opportunity_score DESC LIMIT 20
    `, [store.id]);

    res.json({ store, deals: deals.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

module.exports = router;

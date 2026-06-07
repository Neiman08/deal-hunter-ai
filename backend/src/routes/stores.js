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

// GET /api/stores - Lista todas las tiendas activas
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*,
        COUNT(d.id) FILTER (WHERE d.is_active = true) AS active_deals,
        AVG(d.discount_percent) FILTER (WHERE d.is_active = true) AS avg_discount
      FROM stores s
      LEFT JOIN deals d ON d.store_id = s.id
      WHERE s.is_active = true
      GROUP BY s.id
      ORDER BY active_deals DESC
    `);
    res.json({ stores: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener tiendas' });
  }
});

// GET /api/stores/map?zip=77001&radius=25 - Tiendas para el mapa
router.get('/map', async (req, res) => {
  try {
    const { zip, lat, lng, radius = 25 } = req.query;

    let sql = `
      SELECT
        sl.id, sl.store_number, sl.name, sl.address, sl.city, sl.state,
        sl.zip_code, sl.latitude, sl.longitude, sl.phone,
        s.name AS store_chain, s.slug AS store_slug, s.color AS store_color,
        s.logo_url,
        COUNT(d.id) FILTER (WHERE d.is_active = true) AS deal_count,
        MAX(d.opportunity_score) AS best_score,
        MIN(d.deal_price) AS lowest_price,
        MAX(d.discount_percent) AS max_discount
      FROM store_locations sl
      JOIN stores s ON sl.store_id = s.id
      LEFT JOIN deals d ON d.store_location_id = sl.id
      WHERE sl.is_active = true AND sl.latitude IS NOT NULL
    `;

    const params = [];
    let idx = 1;

    if (zip) {
      sql += ` AND sl.zip_code LIKE $${idx++}`;
      params.push(`${zip.substring(0, 3)}%`);
    }

    sql += ` GROUP BY sl.id, s.id ORDER BY deal_count DESC LIMIT 50`;

    const result = await query(sql, params);
    res.json({ locations: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener mapa de tiendas' });
  }
});

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

// GET /api/stores/:slug - Detalle de tienda
router.get('/:slug', async (req, res) => {
  try {
    const storeResult = await query(
      'SELECT * FROM stores WHERE slug = $1',
      [req.params.slug]
    );

    if (!storeResult.rows[0]) {
      return res.status(404).json({ error: 'Tienda no encontrada' });
    }

    const store = storeResult.rows[0];

    const deals = await query(`
      SELECT d.*, p.name AS product_name, p.image_url
      FROM deals d JOIN products p ON d.product_id = p.id
      WHERE d.store_id = $1 AND d.is_active = true
      ORDER BY d.opportunity_score DESC LIMIT 20
    `, [store.id]);

    res.json({ store, deals: deals.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener tienda' });
  }
});

module.exports = router;

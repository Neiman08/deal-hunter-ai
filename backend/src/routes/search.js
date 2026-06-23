const express = require('express');
const { query } = require('../config/database');

const router = express.Router();

// GET /api/search?q=dewalt&store=home-depot&zip=77001
router.get('/', async (req, res) => {
  try {
    const { q, store, category, zip, upc, sku, min_discount = 0, limit = 20 } = req.query;

    if (!q && !upc && !sku) {
      return res.status(400).json({ error: 'Se requiere término de búsqueda, UPC o SKU' });
    }

    let conditions = [
      'd.is_active = true',
      `(p.is_public_visible = true AND p.quality_status IN ('PASS', 'NEEDS_IMAGE'))`,
    ];
    let params = [];
    let idx = 1;

    if (q) {
      conditions.push(`(p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.description ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }

    if (upc) {
      conditions.push(`p.upc = $${idx++}`);
      params.push(upc);
    }

    if (sku) {
      conditions.push(`p.sku ILIKE $${idx++}`);
      params.push(`%${sku}%`);
    }

    if (store) {
      conditions.push(`s.slug = $${idx++}`);
      params.push(store);
    }

    if (category) {
      conditions.push(`c.slug = $${idx++}`);
      params.push(category);
    }

    if (min_discount > 0) {
      conditions.push(`d.discount_percent >= $${idx++}`);
      params.push(parseFloat(min_discount));
    }

    params.push(parseInt(limit));

    const sql = `
      SELECT
        d.id, d.regular_price, d.deal_price, d.discount_percent,
        d.savings_amount, d.estimated_profit, d.opportunity_score,
        d.opportunity_label, d.stock_quantity, d.is_error_price,
        d.detected_at,
        p.name AS product_name, p.brand, p.image_url, p.upc, p.sku,
        s.name AS store_name, s.slug AS store_slug, s.color AS store_color,
        c.name AS category_name
      FROM deals d
      JOIN products p ON d.product_id = p.id
      JOIN stores s ON d.store_id = s.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.opportunity_score DESC, d.discount_percent DESC
      LIMIT $${idx}
    `;

    const result = await query(sql, params);

    res.json({
      results: result.rows,
      count: result.rows.length,
      query: { q, store, category, upc, sku }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en búsqueda' });
  }
});

// GET /api/search/upc/:upc - Verificar precio por UPC (escáner)
router.get('/upc/:upc', async (req, res) => {
  try {
    const { upc } = req.params;
    const { zip } = req.query;

    const result = await query(`
      SELECT
        d.id, d.regular_price, d.deal_price, d.discount_percent,
        d.savings_amount, d.estimated_profit, d.opportunity_score,
        d.opportunity_label, d.stock_quantity, d.is_error_price,
        p.name AS product_name, p.brand, p.image_url, p.upc, p.sku,
        s.name AS store_name, s.slug AS store_slug, s.color AS store_color,
        sl.address, sl.city, sl.state
      FROM deals d
      JOIN products p ON d.product_id = p.id
      JOIN stores s ON d.store_id = s.id
      LEFT JOIN store_locations sl ON d.store_location_id = sl.id
      WHERE p.upc = $1 AND d.is_active = true
      ORDER BY d.opportunity_score DESC
    `, [upc]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Producto no encontrado',
        upc,
        suggestion: 'Este UPC no tiene ofertas activas en nuestra base de datos'
      });
    }

    res.json({ product: result.rows[0], all_deals: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al buscar UPC' });
  }
});

// GET /api/search/barcode/:code — scanner lookup by UPC or SKU
router.get('/barcode/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (!code || code.length < 3) {
      return res.status(400).json({ found: false, barcode: code, error: 'Invalid barcode' });
    }

    // Search by upc first, then sku (products table has both; no gtin/barcode column)
    const result = await query(`
      SELECT
        p.id AS product_id, p.name, p.brand, p.image_url, p.upc, p.sku,
        p.product_url,
        d.id AS deal_id, d.regular_price, d.deal_price, d.discount_percent,
        d.savings_amount, d.estimated_profit, d.roi_percent,
        d.opportunity_score, d.opportunity_label, d.stock_quantity,
        d.is_error_price, d.resale_price_amazon, d.resale_price_ebay,
        d.resale_price_facebook, d.demand_level, d.estimated_days_to_sell,
        s.name AS store_name, s.slug AS store_slug, s.color AS store_color
      FROM products p
      JOIN stores s ON p.store_id = s.id
      LEFT JOIN deals d ON d.product_id = p.id AND d.is_active = true
      WHERE p.upc = $1 OR p.sku = $1
      ORDER BY d.opportunity_score DESC NULLS LAST
      LIMIT 10
    `, [code]);

    if (result.rows.length === 0) {
      return res.json({ found: false, barcode: code });
    }

    const product = result.rows[0];
    const deals = result.rows.filter(r => r.deal_id);

    res.json({
      found: true,
      barcode: code,
      product: {
        id: product.product_id,
        name: product.name,
        brand: product.brand,
        image_url: product.image_url,
        upc: product.upc,
        sku: product.sku,
        product_url: product.product_url,
        store_name: product.store_name,
        store_slug: product.store_slug,
      },
      deals: deals.map(d => ({
        id: d.deal_id,
        regular_price: d.regular_price,
        deal_price: d.deal_price,
        discount_percent: d.discount_percent,
        savings_amount: d.savings_amount,
        estimated_profit: d.estimated_profit,
        roi_percent: d.roi_percent,
        opportunity_score: d.opportunity_score,
        opportunity_label: d.opportunity_label,
        stock_quantity: d.stock_quantity,
        is_error_price: d.is_error_price,
        resale_price_amazon: d.resale_price_amazon,
        resale_price_ebay: d.resale_price_ebay,
        resale_price_facebook: d.resale_price_facebook,
        demand_level: d.demand_level,
        estimated_days_to_sell: d.estimated_days_to_sell,
        store_name: d.store_name,
        store_slug: d.store_slug,
        store_color: d.store_color,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ found: false, error: 'Search error' });
  }
});

// GET /api/search/suggestions?q=dew - Autocompletado
router.get('/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ suggestions: [] });

    const result = await query(`
      SELECT DISTINCT p.name, p.brand, s.slug as store_slug
      FROM products p
      JOIN deals d ON d.product_id = p.id
      JOIN stores s ON d.store_id = s.id
      WHERE p.name ILIKE $1 AND d.is_active = true
      LIMIT 8
    `, [`%${q}%`]);

    res.json({ suggestions: result.rows });
  } catch (err) {
    res.status(500).json({ suggestions: [] });
  }
});

module.exports = router;

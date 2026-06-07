const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { compareMarkets } = require('../services/marketComparator');
const { query } = require('../config/database');

// GET /markets/compare/:dealId — compare resale across all platforms
router.get('/compare/:dealId', authenticate, async (req, res) => {
  try {
    const dealRes = await query(`
      SELECT d.*, p.name, p.brand, p.upc, c.slug as cat_slug
      FROM deals d
      JOIN products p ON d.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE d.id = $1
    `, [req.params.dealId]);

    if (!dealRes.rows[0]) return res.status(404).json({ error: 'Deal not found' });
    const deal = dealRes.rows[0];

    const comparison = await compareMarkets(
      deal.name, deal.brand, deal.regular_price, deal.cat_slug, deal.upc
    );

    res.json({ comparison, deal_id: req.params.dealId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /markets/compare-upc/:upc — compare by UPC (scanner flow)
router.get('/compare-upc/:upc', authenticate, async (req, res) => {
  try {
    const prodRes = await query(`
      SELECT p.name, p.brand, p.upc, c.slug as cat_slug,
        d.regular_price, d.deal_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN deals d ON d.product_id = p.id AND d.is_active = true
      WHERE p.upc = $1
      LIMIT 1
    `, [req.params.upc]);

    if (!prodRes.rows[0]) {
      return res.json({
        comparison: null,
        message: 'Product not in database yet. Scan it first via /search/upc/:upc',
      });
    }

    const prod = prodRes.rows[0];
    const comparison = await compareMarkets(
      prod.name, prod.brand, prod.regular_price || 100, prod.cat_slug, prod.upc
    );
    res.json({ comparison });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/**
 * Watchlist Routes
 * Users can follow: brands, categories, UPCs, SKUs, specific products
 * When a watched item goes on sale (>20% off), they get alerted
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /watchlist
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await query(`
      SELECT w.*,
        p.name as product_name, p.image_url, p.brand,
        d.deal_price, d.discount_percent, d.opportunity_score, d.is_active as deal_active
      FROM watchlist_items w
      LEFT JOIN products p ON w.product_id = p.id
      LEFT JOIN deals d ON d.product_id = p.id AND d.is_active = true
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `, [req.user.id]);
    res.json({ items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /watchlist
router.post('/', authenticate, async (req, res) => {
  const { type, value, label, min_discount = 20, notify_email = true, notify_whatsapp = false } = req.body;
  const validTypes = ['brand', 'category', 'upc', 'sku', 'product_id', 'keyword'];
  if (!validTypes.includes(type) || !value) {
    return res.status(400).json({ error: 'type and value required' });
  }
  try {
    const r = await query(`
      INSERT INTO watchlist_items (user_id, type, value, label, min_discount, notify_email, notify_whatsapp)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, type, value) DO UPDATE SET label = EXCLUDED.label
      RETURNING *
    `, [req.user.id, type, value, label || value, min_discount, notify_email, notify_whatsapp]);
    res.json({ item: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /watchlist/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM watchlist_items WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /watchlist/alerts — deals matching watchlist items
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const items = await query(`SELECT * FROM watchlist_items WHERE user_id = $1`, [req.user.id]);
    if (!items.rows.length) return res.json({ matches: [] });

    // Build dynamic query to find matching deals
    const matches = [];
    for (const item of items.rows) {
      let dealQuery = '';
      let params = [item.min_discount || 20];
      let p = 2;

      if (item.type === 'brand') {
        dealQuery = `SELECT d.*, p.name, p.brand, s.name as store_name FROM deals d JOIN products p ON d.product_id = p.id JOIN stores s ON d.store_id = s.id WHERE d.is_active = true AND d.discount_percent >= $1 AND LOWER(p.brand) = LOWER($${p++}) ORDER BY d.opportunity_score DESC LIMIT 5`;
        params.push(item.value);
      } else if (item.type === 'upc') {
        dealQuery = `SELECT d.*, p.name, p.brand, s.name as store_name FROM deals d JOIN products p ON d.product_id = p.id JOIN stores s ON d.store_id = s.id WHERE d.is_active = true AND d.discount_percent >= $1 AND p.upc = $${p++} ORDER BY d.opportunity_score DESC LIMIT 5`;
        params.push(item.value);
      } else if (item.type === 'keyword') {
        dealQuery = `SELECT d.*, p.name, p.brand, s.name as store_name FROM deals d JOIN products p ON d.product_id = p.id JOIN stores s ON d.store_id = s.id WHERE d.is_active = true AND d.discount_percent >= $1 AND (LOWER(p.name) LIKE LOWER($${p}) OR LOWER(p.brand) LIKE LOWER($${p})) ORDER BY d.opportunity_score DESC LIMIT 5`;
        params.push(`%${item.value}%`);
      } else {
        continue;
      }

      const result = await query(dealQuery, params);
      if (result.rows.length) matches.push({ watchItem: item, deals: result.rows });
    }

    res.json({ matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

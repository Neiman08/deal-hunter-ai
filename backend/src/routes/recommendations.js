const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generateRecommendations } = require('../services/opportunityEngine');
const { query } = require('../config/database');

// GET /recommendations — AI-powered deal recs for authenticated user
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await generateRecommendations(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// GET /recommendations/favorites — user's brand/product follows
router.get('/favorites', authenticate, async (req, res) => {
  try {
    const r = await query(`
      SELECT * FROM user_favorites WHERE user_id = $1 ORDER BY created_at DESC
    `, [req.user.id]);
    res.json({ favorites: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// POST /recommendations/favorites
router.post('/favorites', authenticate, async (req, res) => {
  const { type, value, store_id, product_id, category_id } = req.body;
  if (!type || !value) return res.status(400).json({ error: 'type and value required' });

  try {
    const r = await query(`
      INSERT INTO user_favorites (user_id, type, value, store_id, product_id, category_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, type, value) DO NOTHING
      RETURNING *
    `, [req.user.id, type, value, store_id || null, product_id || null, category_id || null]);
    res.json({ favorite: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// DELETE /recommendations/favorites/:id
router.delete('/favorites/:id', authenticate, async (req, res) => {
  try {
    await query(`DELETE FROM user_favorites WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete favorite' });
  }
});

// GET /recommendations/insights — AI insights about user behavior
router.get('/insights', authenticate, async (req, res) => {
  try {
    const [activity, saved, profits] = await Promise.all([
      query(`
        SELECT action, COUNT(*) as count, DATE_TRUNC('day', created_at) as day
        FROM user_activity WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY action, day ORDER BY day DESC
      `, [req.user.id]),
      query(`
        SELECT p.brand, c.name as category, d.estimated_profit, d.opportunity_score
        FROM saved_deals sd JOIN deals d ON sd.deal_id = d.id
        JOIN products p ON d.product_id = p.id LEFT JOIN categories c ON p.category_id = c.id
        WHERE sd.user_id = $1
        ORDER BY sd.saved_at DESC LIMIT 50
      `, [req.user.id]),
      query(`
        SELECT SUM(actual_profit) as total_actual, COUNT(*) FILTER (WHERE purchased) as purchased_count
        FROM saved_deals WHERE user_id = $1
      `, [req.user.id]),
    ]);

    res.json({
      activity: activity.rows,
      saved_brands: saved.rows,
      profit_summary: profits.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

module.exports = router;

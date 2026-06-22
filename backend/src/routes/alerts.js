const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/alerts - Alertas del usuario
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT a.*, s.name AS store_name, c.name AS category_name
      FROM user_alerts a
      LEFT JOIN stores s ON a.store_id = s.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
    `, [req.user.id]);
    res.json({ alerts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener alertas' });
  }
});

// POST /api/alerts - Crear alerta
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      name, store_id, category_id, product_keyword,
      min_discount_percent = 30, min_profit = 0, min_score = 0,
      max_distance_miles = 25, zip_code,
      notify_email = true, notify_whatsapp = false, notify_push = true
    } = req.body;

    // Verificar límite de alertas por plan
    const countResult = await query(
      'SELECT COUNT(*) as count FROM user_alerts WHERE user_id = $1 AND is_active = true',
      [req.user.id]
    );

    const limits = { free: 3, pro: 50, elite: 999, beta: 50 };
    const limit = limits[req.user.plan] || 3;

    if (parseInt(countResult.rows[0].count) >= limit) {
      return res.status(403).json({
        error: `Tu plan ${req.user.plan} permite máximo ${limit} alertas activas`,
        upgrade_url: '/pricing'
      });
    }

    const result = await query(`
      INSERT INTO user_alerts (
        user_id, name, store_id, category_id, product_keyword,
        min_discount_percent, min_profit, min_score, max_distance_miles, zip_code,
        notify_email, notify_whatsapp, notify_push
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      req.user.id, name || product_keyword, store_id, category_id, product_keyword,
      min_discount_percent, min_profit, min_score, max_distance_miles, zip_code || req.user.zip_code,
      notify_email, notify_whatsapp, notify_push
    ]);

    res.status(201).json({ alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear alerta' });
  }
});

// PUT /api/alerts/:id - Actualizar alerta
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, min_discount_percent, min_profit, is_active, notify_email, notify_whatsapp } = req.body;

    const result = await query(`
      UPDATE user_alerts SET
        name = COALESCE($1, name),
        min_discount_percent = COALESCE($2, min_discount_percent),
        min_profit = COALESCE($3, min_profit),
        is_active = COALESCE($4, is_active),
        notify_email = COALESCE($5, notify_email),
        notify_whatsapp = COALESCE($6, notify_whatsapp)
      WHERE id = $7 AND user_id = $8
      RETURNING *
    `, [name, min_discount_percent, min_profit, is_active, notify_email, notify_whatsapp, req.params.id, req.user.id]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Alerta no encontrada' });
    }
    res.json({ alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar alerta' });
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query(
      'DELETE FROM user_alerts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar alerta' });
  }
});

module.exports = router;

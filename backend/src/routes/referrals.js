/**
 * Referral System
 * - Unique referral codes per user
 * - Track signups, conversions
 * - Reward structure: 1 month Pro for referrer on paid conversion
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');

function generateCode(name) {
  const base = (name || 'user').split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${base}${rand}`;
}

// GET /referrals — my referral dashboard
router.get('/', authenticate, async (req, res) => {
  try {
    let ref = await query('SELECT * FROM referrals WHERE user_id = $1', [req.user.id]);

    // Create code on first access
    if (!ref.rows[0]) {
      const code = generateCode(req.user.name);
      ref = await query(`
        INSERT INTO referrals (user_id, code) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET code = referrals.code
        RETURNING *
      `, [req.user.id, code]);
    }

    const stats = await query(`
      SELECT
        COUNT(*) as total_signups,
        COUNT(*) FILTER (WHERE converted_to_paid) as conversions,
        SUM(reward_months) as months_earned
      FROM referral_events WHERE referrer_id = $1
    `, [req.user.id]);

    const recent = await query(`
      SELECT re.created_at, re.converted_to_paid, re.reward_months,
        u.name as referee_name, u.email as referee_email, u.plan
      FROM referral_events re
      JOIN users u ON re.referee_id = u.id
      WHERE re.referrer_id = $1
      ORDER BY re.created_at DESC LIMIT 20
    `, [req.user.id]);

    res.json({
      code: ref.rows[0].code,
      referral_link: `${process.env.FRONTEND_URL || 'https://dealhunter.ai'}/signup?ref=${ref.rows[0].code}`,
      stats: stats.rows[0],
      recent: recent.rows,
      rewards: {
        per_signup: '0',
        per_conversion: '1 month Pro free',
        description: 'Get 1 free month of Pro for every user who upgrades to a paid plan.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /referrals/apply — apply referral code at signup (called by auth route)
router.post('/apply', async (req, res) => {
  const { code, new_user_id } = req.body;
  if (!code || !new_user_id) return res.status(400).json({ error: 'code and new_user_id required' });

  try {
    const ref = await query('SELECT * FROM referrals WHERE UPPER(code) = UPPER($1)', [code]);
    if (!ref.rows[0]) return res.status(404).json({ error: 'Invalid referral code' });

    const referrer = ref.rows[0];
    if (referrer.user_id === new_user_id) return res.status(400).json({ error: 'Cannot refer yourself' });

    // Record the referral signup
    await query(`
      INSERT INTO referral_events (referrer_id, referee_id, code)
      VALUES ($1, $2, $3)
      ON CONFLICT (referee_id) DO NOTHING
    `, [referrer.user_id, new_user_id, code]);

    // Track referral on new user
    await query('UPDATE users SET referred_by = $1 WHERE id = $2', [code, new_user_id]);

    res.json({ applied: true, referrer_id: referrer.user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /referrals/convert — called by Stripe webhook when referral converts to paid
router.post('/convert', async (req, res) => {
  const { user_id } = req.body;
  try {
    const event = await query(`
      UPDATE referral_events
      SET converted_to_paid = true, converted_at = NOW(), reward_months = 1
      WHERE referee_id = $1 AND NOT converted_to_paid
      RETURNING referrer_id
    `, [user_id]);

    if (event.rows[0]) {
      // Extend referrer's plan by 1 month
      await query(`
        UPDATE users
        SET plan = CASE WHEN plan = 'free' THEN 'pro' ELSE plan END,
            plan_expires_at = COALESCE(plan_expires_at, NOW()) + INTERVAL '1 month'
        WHERE id = $1
      `, [event.rows[0].referrer_id]);
    }

    res.json({ converted: !!event.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

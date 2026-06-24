const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');
const { trackReferUser } = require('../services/businessActions');

function generateCode(name) {
  const base = (name || 'user').split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${base}${rand}`;
}

// Reward tiers — cumulative (total paid conversions)
const REFERRAL_TIERS = [
  { threshold: 1,  type: 'pro_7_days',    label: '7 days Pro free',   reward: { kind: 'days', value: 7 } },
  { threshold: 3,  type: 'pro_1_month',   label: '1 month Pro free',  reward: { kind: 'months', value: 1 } },
  { threshold: 5,  type: 'credit_10',     label: '$10 account credit',reward: { kind: 'credit', value: 10 } },
  { threshold: 10, type: 'credit_25',     label: '$25 account credit',reward: { kind: 'credit', value: 25 } },
  { threshold: 25, type: 'pro_lifetime',  label: 'Lifetime Pro',      reward: { kind: 'lifetime', value: 0 } },
];

async function applyTierReward(userId, tier) {
  const { reward } = tier;
  if (reward.kind === 'days') {
    await query(`
      UPDATE users
      SET plan = CASE WHEN plan = 'free' THEN 'pro' ELSE plan END,
          plan_expires_at = COALESCE(plan_expires_at, NOW()) + ($1 || ' days')::INTERVAL
      WHERE id = $2
    `, [reward.value, userId]);
  } else if (reward.kind === 'months') {
    await query(`
      UPDATE users
      SET plan = CASE WHEN plan = 'free' THEN 'pro' ELSE plan END,
          plan_expires_at = COALESCE(plan_expires_at, NOW()) + ($1 || ' months')::INTERVAL
      WHERE id = $2
    `, [reward.value, userId]);
  } else if (reward.kind === 'credit') {
    await query(`
      INSERT INTO contributor_wallets (user_id, credit_balance)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET credit_balance = contributor_wallets.credit_balance + $2, updated_at = NOW()
    `, [userId, reward.value]);
  } else if (reward.kind === 'lifetime') {
    await query(`UPDATE users SET plan = 'pro', plan_expires_at = '2099-12-31' WHERE id = $1`, [userId]);
  }
  // Log in contributor_rewards
  await query(`
    INSERT INTO contributor_rewards (user_id, reward_type, points_cost, value_description, status, redeemed_at)
    VALUES ($1, $2, 0, $3, 'active', NOW())
  `, [userId, tier.type, tier.label]);
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

    const conversions = parseInt(stats.rows[0]?.conversions || 0);
    const tiersStatus = REFERRAL_TIERS.map(t => ({
      threshold:    t.threshold,
      type:         t.type,
      label:        t.label,
      reached:      conversions >= t.threshold,
      remaining:    Math.max(0, t.threshold - conversions),
    }));

    res.json({
      code:          ref.rows[0].code,
      referral_link: `${process.env.FRONTEND_URL || 'https://deal-hunter-ai-frontend.onrender.com'}/#/login?ref=${ref.rows[0].code}&mode=register`,
      stats:         stats.rows[0],
      recent:        recent.rows,
      tiers:         tiersStatus,
      rewards: {
        per_conversion: '7 days → 1 month → $10 → $25 → Lifetime Pro',
        description: 'Earn bigger rewards as you refer more users.',
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

    // Fire-and-forget: mission + XP for the referrer
    trackReferUser(referrer.user_id).catch(() => {});

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

    if (!event.rows[0]) return res.json({ converted: false });
    const referrerId = event.rows[0].referrer_id;

    // Count total conversions for this referrer
    const countRes = await query(`
      SELECT COUNT(*) as total, r.last_tier_awarded
      FROM referral_events re
      JOIN referrals r ON r.user_id = re.referrer_id
      WHERE re.referrer_id = $1 AND re.converted_to_paid = true
      GROUP BY r.last_tier_awarded
    `, [referrerId]);

    const totalConversions = parseInt(countRes.rows[0]?.total || 1);
    const lastTier = parseInt(countRes.rows[0]?.last_tier_awarded || 0);

    // Award all newly unlocked tiers
    const newTiers = REFERRAL_TIERS.filter(
      t => t.threshold <= totalConversions && t.threshold > lastTier
    );

    for (const tier of newTiers) {
      await applyTierReward(referrerId, tier);
    }

    if (newTiers.length > 0) {
      const highestUnlocked = Math.max(...newTiers.map(t => t.threshold));
      await query(`UPDATE referrals SET last_tier_awarded = $1 WHERE user_id = $2`, [highestUnlocked, referrerId]);
    }

    res.json({
      converted:    true,
      total_conversions: totalConversions,
      tiers_unlocked: newTiers.map(t => t.label),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

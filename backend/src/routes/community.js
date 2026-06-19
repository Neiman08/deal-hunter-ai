const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { trackConfirmDeal } = require('../services/businessActions');
const logger = require('../utils/logger');

// ── Points for deal lifecycle ─────────────────────────────────────────────────
const POINTS = {
  deal_verified: 10,   // overridden by deal's points_pending
  deal_official: 50,
  confirmation:  5,
};

function getLevel(points) {
  if (points >= 5000) return 'Legend Hunter';
  if (points >= 2500) return 'Elite Hunter';
  if (points >= 1000) return 'Gold Hunter';
  if (points >= 500)  return 'Silver Hunter';
  if (points >= 100)  return 'Bronze Hunter';
  return 'Rookie Hunter';
}

async function awardPoints(collaboratorId, userId, dealId, action, pts, description) {
  await query(
    `INSERT INTO collaborator_points_log (collaborator_id, submitted_deal_id, action, points, description)
     VALUES ($1,$2,$3,$4,$5)`,
    [collaboratorId, dealId, action, pts, description]
  );
  const res = await query(
    `UPDATE collaborator_profiles
     SET points = points + $1, updated_at = NOW()
     WHERE id = $2 RETURNING points`,
    [pts, collaboratorId]
  );
  const newPoints = res.rows[0]?.points || 0;
  await query(
    `UPDATE collaborator_profiles SET level = $1 WHERE id = $2`,
    [getLevel(newPoints), collaboratorId]
  );
  // Also update wallet
  await query(`
    INSERT INTO contributor_wallets (user_id, points_available, lifetime_points)
    VALUES ($1, $2, $2)
    ON CONFLICT (user_id) DO UPDATE
    SET points_available = contributor_wallets.points_available + $2,
        lifetime_points  = contributor_wallets.lifetime_points  + $2,
        updated_at       = NOW()
  `, [userId, pts]);
  return newPoints;
}

async function promoteToVerified(dealId) {
  const dealRes = await query(
    `SELECT sd.*, cp.id as collaborator_id, sd.user_id,
            sd.points_pending, sd.opportunity_score
     FROM submitted_deals sd
     LEFT JOIN collaborator_profiles cp ON sd.user_id = cp.user_id
     WHERE sd.id = $1`,
    [dealId]
  );
  const deal = dealRes.rows[0];
  if (!deal) return;

  await query(
    `UPDATE submitted_deals SET status='verified', updated_at=NOW() WHERE id=$1`,
    [dealId]
  );

  // Award pending points to submitter
  const pts = deal.points_pending || POINTS.deal_verified;
  if (deal.collaborator_id) {
    await awardPoints(deal.collaborator_id, deal.user_id, dealId, 'deal_verified', pts, 'Deal verified by community');
  }
  // Mark earning as available
  await query(
    `UPDATE contributor_earnings SET status='available', updated_at=NOW()
     WHERE submitted_deal_id=$1 AND earning_type='deal_verified'`,
    [dealId]
  );

  // Publish to deal_posts (feed) if not already there
  if (deal.collaborator_id) {
    await query(`
      INSERT INTO deal_posts (
        collaborator_id, submitted_deal_id, title, store_name,
        deal_price, profit_estimate, status, created_at
      )
      SELECT $1, $2, sd.product_name, s.name,
             sd.found_price, sd.estimated_profit, 'published', NOW()
      FROM submitted_deals sd
      LEFT JOIN stores s ON sd.store_id = s.id
      WHERE sd.id = $2
      ON CONFLICT DO NOTHING
    `, [deal.collaborator_id, dealId]);
  }

  // Improve submitter trust score
  await query(`
    UPDATE collaborator_profiles
    SET trust_score = LEAST(100, trust_score + 5),
        approved_deals_count = approved_deals_count + 1,
        updated_at = NOW()
    WHERE user_id = $1
  `, [deal.user_id]);

  logger.info(`[Community] deal ${dealId} promoted to verified, awarded ${pts} pts`);
}

// ── GET /api/community/deals ──────────────────────────────────────────────────
// Public feed of verified/official deals submitted by the community
router.get('/deals', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status || 'verified,official';
    const statusList = status.split(',').map(s => s.trim());

    const r = await query(`
      SELECT
        sd.id, sd.product_name, sd.brand, sd.found_price, sd.estimated_profit,
        sd.roi_percent, sd.opportunity_score, sd.recommendation,
        sd.effective_market_price, sd.effective_market_source,
        sd.photo_url, sd.confirmation_count, sd.feedback_tag,
        sd.status, sd.created_at,
        s.name  AS store_name,  s.slug AS store_slug, s.color AS store_color,
        sl.city AS store_city,  sl.state AS store_state,
        sl.latitude, sl.longitude,
        cp.display_name AS submitter_name, cp.level AS submitter_level
      FROM submitted_deals sd
      LEFT JOIN stores s ON sd.store_id = s.id
      LEFT JOIN store_locations sl ON sd.store_location_id = sl.id
      LEFT JOIN collaborator_profiles cp ON sd.collaborator_id = cp.id
      WHERE sd.status = ANY($1)
      ORDER BY sd.created_at DESC
      LIMIT $2 OFFSET $3
    `, [statusList, limit, offset]);

    const countRes = await query(
      `SELECT COUNT(*) FROM submitted_deals WHERE status = ANY($1)`,
      [statusList]
    );

    res.json({ deals: r.rows, total: parseInt(countRes.rows[0].count), limit, offset });
  } catch (err) {
    logger.error(`[Community] GET /deals error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch community deals' });
  }
});

// ── GET /api/community/deals/:id ──────────────────────────────────────────────
router.get('/deals/:id', async (req, res) => {
  try {
    const r = await query(`
      SELECT
        sd.*,
        s.name AS store_name, s.slug AS store_slug, s.color AS store_color,
        sl.address, sl.city, sl.state, sl.zip_code,
        sl.latitude AS loc_lat, sl.longitude AS loc_lng,
        cp.display_name AS submitter_name, cp.level AS submitter_level,
        cp.trust_score AS submitter_trust
      FROM submitted_deals sd
      LEFT JOIN stores s  ON sd.store_id = s.id
      LEFT JOIN store_locations sl ON sd.store_location_id = sl.id
      LEFT JOIN collaborator_profiles cp ON sd.collaborator_id = cp.id
      WHERE sd.id = $1
    `, [req.params.id]);

    if (!r.rows[0]) return res.status(404).json({ error: 'Deal not found' });

    // Get confirmations
    const confRes = await query(`
      SELECT sdc.confirmation_type, COUNT(*) as count
      FROM submitted_deal_confirmations sdc
      WHERE sdc.submitted_deal_id = $1
      GROUP BY sdc.confirmation_type
    `, [req.params.id]);

    res.json({ deal: r.rows[0], confirmations: confRes.rows });
  } catch (err) {
    logger.error(`[Community] GET /deals/:id error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch deal' });
  }
});

// ── POST /api/community/deals/:id/confirm ─────────────────────────────────────
router.post('/deals/:id/confirm', authenticate, async (req, res) => {
  const dealId = req.params.id;
  const { confirmation_type, price_seen, notes } = req.body;

  const validTypes = ['price_confirmed', 'in_stock', 'out_of_stock', 'price_mismatch', 'not_found', 'wrong_product', 'expired', 'great_deal'];
  if (!validTypes.includes(confirmation_type)) {
    return res.status(400).json({ error: 'Invalid confirmation_type', valid: validTypes });
  }

  try {
    // Fetch deal
    const dealRes = await query(
      `SELECT user_id, status, trust_threshold, confirmation_count, negative_count FROM submitted_deals WHERE id=$1`,
      [dealId]
    );
    if (!dealRes.rows[0]) return res.status(404).json({ error: 'Deal not found' });
    const deal = dealRes.rows[0];

    // Anti-fraud: can't confirm own deal
    if (deal.user_id === req.user.id) {
      return res.status(403).json({ error: 'You cannot confirm your own deal.' });
    }

    // Anti-fraud: deal must be in confirmable state
    if (!['submitted', 'pending_confirmation'].includes(deal.status)) {
      return res.status(409).json({ error: `Deal is already ${deal.status} and cannot receive new confirmations.` });
    }

    // Insert confirmation (unique constraint prevents duplicates)
    try {
      await query(`
        INSERT INTO submitted_deal_confirmations (submitted_deal_id, user_id, confirmation_type, price_seen, notes)
        VALUES ($1, $2, $3, $4, $5)
      `, [dealId, req.user.id, confirmation_type, price_seen || null, notes || null]);
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: 'You have already confirmed this deal.' });
      }
      throw e;
    }

    // Positive = found/confirmed, negative = not found / mismatch
    const isPositive = ['price_confirmed', 'in_stock', 'great_deal'].includes(confirmation_type);
    const isNegative = ['not_found', 'price_mismatch'].includes(confirmation_type);

    // Update counts and status
    const updateRes = await query(`
      UPDATE submitted_deals
      SET confirmation_count = confirmation_count + $1,
          negative_count     = negative_count     + $2,
          status = CASE
            WHEN status IN ('submitted','pending_confirmation') THEN 'pending_confirmation'
            ELSE status
          END,
          updated_at = NOW()
      WHERE id = $3
      RETURNING confirmation_count, negative_count, trust_threshold, status
    `, [isPositive ? 1 : 0, isNegative ? 1 : 0, dealId]);

    const updated = updateRes.rows[0];

    // Award confirmer 5 points (existing system) + 3 XP via Business layer (fire-and-forget)
    let cpRes = await query('SELECT id FROM collaborator_profiles WHERE user_id=$1', [req.user.id]);
    if (cpRes.rows[0]) {
      await awardPoints(cpRes.rows[0].id, req.user.id, dealId, 'confirmation', POINTS.confirmation, 'Confirmed a community deal');
    }
    trackConfirmDeal(req.user.id, dealId).catch(() => {});

    // Auto-promote to verified if enough positive confirmations
    const threshold = updated.trust_threshold || 2;
    if (updated.confirmation_count >= threshold && updated.status !== 'verified') {
      await promoteToVerified(dealId);
      return res.json({
        confirmed: true,
        confirmation_type,
        new_status: 'verified',
        message: `Deal verified! Submitter earned their points.`,
        points_awarded: POINTS.confirmation,
      });
    }

    res.json({
      confirmed: true,
      confirmation_type,
      confirmation_count: updated.confirmation_count,
      confirmations_needed: Math.max(0, threshold - updated.confirmation_count),
      new_status: updated.status,
      points_awarded: POINTS.confirmation,
    });
  } catch (err) {
    logger.error(`[Community] confirm error: ${err.message}`);
    res.status(500).json({ error: 'Failed to record confirmation', details: err.message });
  }
});

// ── GET /api/community/leaderboard ───────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const period = req.query.period || 'all';
    const dateFilter = period === 'month'
      ? `AND cp.updated_at > NOW() - INTERVAL '30 days'`
      : period === 'week'
        ? `AND cp.updated_at > NOW() - INTERVAL '7 days'`
        : '';

    const r = await query(`
      SELECT
        cp.display_name, cp.level, cp.points, cp.trust_score,
        cp.approved_deals_count,
        u.email,
        RANK() OVER (ORDER BY cp.points DESC) as rank
      FROM collaborator_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.is_active = true ${dateFilter}
      ORDER BY cp.points DESC
      LIMIT 25
    `);

    res.json({ leaderboard: r.rows, period });
  } catch (err) {
    logger.error(`[Community] leaderboard error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ── GET /api/community/my-deals ───────────────────────────────────────────────
router.get('/my-deals', authenticate, async (req, res) => {
  try {
    const r = await query(`
      SELECT
        sd.id, sd.product_name, sd.brand, sd.found_price, sd.estimated_profit,
        sd.roi_percent, sd.opportunity_score, sd.recommendation,
        sd.status, sd.confirmation_count, sd.trust_threshold,
        sd.points_pending, sd.points_awarded, sd.created_at,
        s.name AS store_name, s.slug AS store_slug, s.color AS store_color
      FROM submitted_deals sd
      LEFT JOIN stores s ON sd.store_id = s.id
      WHERE sd.user_id = $1
      ORDER BY sd.created_at DESC
      LIMIT 50
    `, [req.user.id]);

    res.json({ deals: r.rows, total: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch your deals' });
  }
});

// ── GET /api/community/wallet ─────────────────────────────────────────────────
router.get('/wallet', authenticate, async (req, res) => {
  try {
    // Auto-create wallet if missing
    await query(`
      INSERT INTO contributor_wallets (user_id) VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [req.user.id]);

    const wallet = await query(
      'SELECT * FROM contributor_wallets WHERE user_id=$1',
      [req.user.id]
    );
    const earnings = await query(`
      SELECT ce.*, sd.product_name
      FROM contributor_earnings ce
      LEFT JOIN submitted_deals sd ON ce.submitted_deal_id = sd.id
      WHERE ce.user_id = $1
      ORDER BY ce.created_at DESC
      LIMIT 20
    `, [req.user.id]);

    const profile = await query(
      'SELECT points, level, trust_score, approved_deals_count FROM collaborator_profiles WHERE user_id=$1',
      [req.user.id]
    );

    res.json({
      wallet: wallet.rows[0],
      recent_earnings: earnings.rows,
      profile: profile.rows[0] || null,
    });
  } catch (err) {
    logger.error(`[Community] wallet error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// ── Monetization: points redemption tiers ─────────────────────────────────────
const REDEMPTION_TIERS = [
  { id: 'pro_1_month',   points: 500,   label: '1 month Pro',   kind: 'pro_months',  value: 1  },
  { id: 'credit_10',     points: 1000,  label: '$10 credit',    kind: 'credit',      value: 10 },
  { id: 'credit_25',     points: 2500,  label: '$25 credit',    kind: 'credit',      value: 25 },
  { id: 'credit_75',     points: 5000,  label: '$75 credit',    kind: 'credit',      value: 75 },
  { id: 'credit_200',    points: 10000, label: '$200 credit',   kind: 'credit',      value: 200 },
];

// GET /api/community/redemption-tiers
router.get('/redemption-tiers', authenticate, async (req, res) => {
  try {
    const w = await query('SELECT points_available FROM contributor_wallets WHERE user_id=$1', [req.user.id]);
    const available = w.rows[0]?.points_available || 0;
    res.json({
      available_points: available,
      tiers: REDEMPTION_TIERS.map(t => ({ ...t, can_redeem: available >= t.points })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch redemption tiers' });
  }
});

// POST /api/community/redeem
router.post('/redeem', authenticate, async (req, res) => {
  const { tier_id } = req.body;
  const tier = REDEMPTION_TIERS.find(t => t.id === tier_id);
  if (!tier) return res.status(400).json({ error: 'Invalid tier_id' });

  try {
    const w = await query('SELECT points_available FROM contributor_wallets WHERE user_id=$1', [req.user.id]);
    const available = w.rows[0]?.points_available || 0;
    if (available < tier.points) {
      return res.status(402).json({ error: `Need ${tier.points} pts, you have ${available}` });
    }

    // Deduct points
    await query(`
      UPDATE contributor_wallets
      SET points_available = points_available - $1, points_redeemed = points_redeemed + $1, updated_at = NOW()
      WHERE user_id = $2
    `, [tier.points, req.user.id]);

    // Apply reward
    if (tier.kind === 'pro_months') {
      await query(`
        UPDATE users
        SET plan = 'pro',
            plan_expires_at = COALESCE(plan_expires_at, NOW()) + ($1 || ' months')::INTERVAL
        WHERE id = $2
      `, [tier.value, req.user.id]);
    } else if (tier.kind === 'credit') {
      await query(`
        UPDATE contributor_wallets SET credit_balance = credit_balance + $1, updated_at = NOW() WHERE user_id = $2
      `, [tier.value, req.user.id]);
    }

    // Log reward
    await query(`
      INSERT INTO contributor_rewards (user_id, reward_type, points_cost, value_description, status, redeemed_at)
      VALUES ($1, $2, $3, $4, 'active', NOW())
    `, [req.user.id, tier.id, tier.points, tier.label]);

    logger.info(`[Community] redemption: user=${req.user.id} tier=${tier.id} pts=${tier.points}`);
    res.json({ redeemed: true, tier: tier.label, remaining_points: available - tier.points });
  } catch (err) {
    logger.error(`[Community] redeem error: ${err.message}`);
    res.status(500).json({ error: 'Redemption failed' });
  }
});

module.exports = router;

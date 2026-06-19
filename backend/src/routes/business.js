const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── Level system — 4 tiers ────────────────────────────────────────────────────
const LEVELS = [
  { name: 'Hunter',           tier: 1, min: 0,     next: 1000  },
  { name: 'Líder',            tier: 2, min: 1000,  next: 5000  },
  { name: 'Director Regional',tier: 3, min: 5000,  next: 20000 },
  { name: 'Director Nacional',tier: 4, min: 20000, next: null  },
];

function getBusinessLevel(points) {
  const xp = points || 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].min) return LEVELS[i];
  }
  return LEVELS[0];
}

// ── Helper: period clause for mission type ─────────────────────────────────────
function periodClause(type) {
  if (type === 'daily')     return 'mp.period = CURRENT_DATE';
  if (type === 'weekly')    return "mp.period >= date_trunc('week', CURRENT_DATE)::date";
  if (type === 'monthly')   return "mp.period >= date_trunc('month', CURRENT_DATE)::date";
  return "mp.period = '2000-01-01'"; // permanent
}

// ── GET /api/business/home ────────────────────────────────────────────────────
router.get('/home', async (req, res) => {
  try {
    const uid = req.user.id;

    // Ensure collaborator profile exists (auto-create on first Business visit)
    let profRes = await query('SELECT * FROM collaborator_profiles WHERE user_id=$1', [uid]);
    if (!profRes.rows[0]) {
      const name = req.user.name || req.user.email?.split('@')[0] || 'Hunter';
      await query(
        `INSERT INTO collaborator_profiles (user_id, display_name)
         VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`,
        [uid, name]
      );
      profRes = await query('SELECT * FROM collaborator_profiles WHERE user_id=$1', [uid]);
    }
    const profile = profRes.rows[0] || {};

    // Wallet
    const walletRes = await query('SELECT * FROM contributor_wallets WHERE user_id=$1', [uid]);
    const wallet = walletRes.rows[0] || {};

    // Referral stats
    const refRes = await query(
      `SELECT COUNT(*) AS total_signups,
              COUNT(*) FILTER (WHERE converted_to_paid) AS conversions
       FROM referral_events WHERE referrer_id=$1`,
      [uid]
    );
    const refStats = refRes.rows[0] || { total_signups: 0, conversions: 0 };

    // Referral code
    const refCodeRes = await query('SELECT code FROM referrals WHERE user_id=$1', [uid]);
    const refCode = refCodeRes.rows[0]?.code || null;

    // Team
    let team = null;
    if (profile.team_id) {
      const tRes = await query(
        `SELECT t.id, t.name, t.slug, t.city, t.points,
                COUNT(tm.id) FILTER (WHERE tm.is_active) AS member_count
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id
         WHERE t.id=$1
         GROUP BY t.id`,
        [profile.team_id]
      );
      team = tRes.rows[0] || null;
    }

    // Level + XP progress
    const pts = profile.points || 0;
    const level = getBusinessLevel(pts);
    const progress = level.next
      ? Math.min(100, Math.round(((pts - level.min) / (level.next - level.min)) * 100))
      : 100;

    // Global rank (among active collaborator_profiles)
    const rankRes = await query(
      `SELECT COUNT(*)+1 AS rank FROM collaborator_profiles WHERE points > $1 AND is_active=true`,
      [pts]
    );
    const rank = parseInt(rankRes.rows[0]?.rank || 1);

    // Active missions + progress
    const missionsRes = await query(
      `SELECT m.id, m.slug, m.title, m.description, m.type, m.action, m.target, m.xp_reward,
              COALESCE(mp.progress, 0) AS progress,
              COALESCE(mp.completed, false) AS completed,
              COALESCE(mp.rewarded, false) AS rewarded
       FROM business_missions m
       LEFT JOIN business_mission_progress mp
         ON mp.mission_id = m.id AND mp.user_id=$1 AND (
              (m.type='daily'     AND mp.period = CURRENT_DATE) OR
              (m.type='weekly'    AND mp.period >= date_trunc('week',  CURRENT_DATE)::date) OR
              (m.type='monthly'   AND mp.period >= date_trunc('month', CURRENT_DATE)::date) OR
              (m.type='permanent' AND mp.period = '2000-01-01')
            )
       WHERE m.is_active=true
       ORDER BY m.type, COALESCE(mp.completed,false), m.xp_reward DESC`,
      [uid]
    );

    // Recent earnings
    const earningsRes = await query(
      `SELECT earning_type, points, credit_amount, status, created_at
       FROM contributor_earnings WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 10`,
      [uid]
    );

    // Badges
    const badgesRes = await query(
      'SELECT badge_slug, badge_name, awarded_at FROM hunter_badges WHERE user_id=$1 ORDER BY awarded_at DESC',
      [uid]
    );

    res.json({
      user: {
        id:    req.user.id,
        name:  req.user.name,
        email: req.user.email,
        plan:  req.user.plan,
      },
      profile: {
        display_name:  profile.display_name || req.user.name,
        level:         level.name,
        tier:          level.tier,
        points:        pts,
        progress,
        next_level_at: level.next,
        next_level_name: level.next
          ? LEVELS.find(l => l.min === level.next)?.name
          : null,
        trust_score:   profile.trust_score   || 50,
        approved_deals: profile.approved_deals_count || 0,
        pending_deals:  profile.pending_deals_count  || 0,
        scan_count:     profile.scan_count    || 0,
        xp_this_month:  profile.xp_this_month || 0,
      },
      wallet: {
        points_available: wallet.points_available  || 0,
        points_pending:   wallet.points_pending    || 0,
        credit_balance:   parseFloat(wallet.credit_balance  || 0).toFixed(2),
        lifetime_points:  wallet.lifetime_points   || 0,
      },
      referrals: {
        code:          refCode,
        referral_link: refCode
          ? `${process.env.FRONTEND_URL || 'https://deal-hunter-ai-frontend.onrender.com'}/#/signup?ref=${refCode}`
          : null,
        total_signups: parseInt(refStats.total_signups || 0),
        conversions:   parseInt(refStats.conversions   || 0),
      },
      team,
      rank,
      missions: missionsRes.rows,
      recent_earnings: earningsRes.rows,
      badges: badgesRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/missions/:slug/progress ────────────────────────────────
router.post('/missions/:slug/progress', async (req, res) => {
  try {
    const { slug } = req.params;
    const uid = req.user.id;

    const mRes = await query(
      'SELECT * FROM business_missions WHERE slug=$1 AND is_active=true',
      [slug]
    );
    if (!mRes.rows[0]) return res.status(404).json({ error: 'Mission not found' });
    const mission = mRes.rows[0];

    // Period for this mission type
    const periodSql = {
      daily:     'CURRENT_DATE',
      weekly:    "date_trunc('week', CURRENT_DATE)::date",
      monthly:   "date_trunc('month', CURRENT_DATE)::date",
      permanent: "'2000-01-01'::date",
    }[mission.type] || 'CURRENT_DATE';

    const upd = await query(`
      INSERT INTO business_mission_progress (user_id, mission_id, progress, period)
      VALUES ($1, $2, 1, ${periodSql})
      ON CONFLICT (user_id, mission_id, period)
      DO UPDATE SET
        progress   = LEAST(business_mission_progress.progress + 1, $3),
        updated_at = NOW()
      RETURNING *
    `, [uid, mission.id, mission.target]);

    const prog = upd.rows[0];
    const justCompleted = prog.progress >= mission.target && !prog.completed && !prog.rewarded;
    let xp_awarded = 0;

    if (justCompleted) {
      await query(
        `UPDATE business_mission_progress
         SET completed=true, rewarded=true, completed_at=NOW()
         WHERE id=$1`,
        [prog.id]
      );
      xp_awarded = mission.xp_reward;

      // Award XP to collaborator_profile
      await query(
        `UPDATE collaborator_profiles
         SET points = points + $1, xp_this_month = xp_this_month + $1, updated_at = NOW()
         WHERE user_id=$2`,
        [xp_awarded, uid]
      );

      // Also update wallet lifetime points
      await query(`
        INSERT INTO contributor_wallets (user_id, points_available, lifetime_points)
        VALUES ($1, $2, $2)
        ON CONFLICT (user_id) DO UPDATE
        SET points_available = contributor_wallets.points_available + $2,
            lifetime_points  = contributor_wallets.lifetime_points  + $2,
            updated_at       = NOW()
      `, [uid, xp_awarded]);

      // Log in collaborator_points_log
      await query(`
        INSERT INTO collaborator_points_log (collaborator_id, action, points, description)
        SELECT id, 'mission_complete', $1, $2 FROM collaborator_profiles WHERE user_id=$3
      `, [xp_awarded, `Mission: ${mission.title}`, uid]);
    }

    res.json({
      slug:        mission.slug,
      progress:    prog.progress,
      target:      mission.target,
      completed:   justCompleted,
      xp_awarded,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/levels ──────────────────────────────────────────────────
router.get('/levels', (_req, res) => {
  res.json({ levels: LEVELS });
});

module.exports = router;
module.exports.getBusinessLevel = getBusinessLevel;

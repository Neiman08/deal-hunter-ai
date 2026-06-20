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

    // Recent transactions (Phase B)
    const txRes = await query(
      `SELECT type, xp_delta, points_delta, amount_delta, status, reference_type, description, created_at
       FROM hunter_transactions WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 15`,
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
      recent_transactions: txRes.rows,
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

// ── GET /api/business/wallet ──────────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  try {
    const uid = req.user.id;

    // Auto-create wallet if missing
    await query(`INSERT INTO contributor_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [uid]);

    const walletRes = await query('SELECT * FROM contributor_wallets WHERE user_id=$1', [uid]);
    const wallet    = walletRes.rows[0] || {};

    const profileRes = await query(
      `SELECT points, xp_this_month, trust_score FROM collaborator_profiles WHERE user_id=$1`,
      [uid]
    );
    const profile = profileRes.rows[0] || {};

    const pts   = profile.points || 0;
    const level = getBusinessLevel(pts);
    const progress = level.next
      ? Math.min(100, Math.round(((pts - level.min) / (level.next - level.min)) * 100))
      : 100;

    // Pending earnings from contributor_earnings
    const pendingEarningsRes = await query(`
      SELECT COALESCE(SUM(credit_amount),0) AS pending_money,
             COALESCE(SUM(points),0)        AS pending_points
      FROM contributor_earnings WHERE user_id=$1 AND status='pending'
    `, [uid]);
    const pe = pendingEarningsRes.rows[0] || {};

    // Recent transactions
    const txRes = await query(`
      SELECT type, xp_delta, points_delta, amount_delta, status, reference_type, description, created_at
      FROM hunter_transactions WHERE user_id=$1
      ORDER BY created_at DESC LIMIT 25
    `, [uid]);

    res.json({
      points: {
        available: wallet.points_available  || 0,
        pending:   wallet.points_pending    || 0,
        lifetime:  wallet.lifetime_points   || 0,
      },
      xp: {
        total:           pts,
        this_month:      profile.xp_this_month || 0,
        next_level_at:   level.next,
        next_level_name: level.next ? LEVELS.find(l => l.min === level.next)?.name : null,
        progress_percent: progress,
        level:            level.name,
        tier:             level.tier,
      },
      money: {
        available: parseFloat(wallet.credit_balance || 0).toFixed(2),
        pending:   parseFloat(pe.pending_money || 0).toFixed(2),
        lifetime:  '0.00', // future: sum of paid withdrawals
      },
      transactions: txRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/levels ──────────────────────────────────────────────────
router.get('/levels', (_req, res) => {
  res.json({ levels: LEVELS });
});

// ── GET /api/business/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const uid    = req.user.id;
    const period = ['day','week','month'].includes(req.query.period) ? req.query.period : 'week';

    const interval = period === 'day' ? '1 day' : period === 'week' ? '7 days' : '30 days';
    const dateFilter = `AND created_at >= NOW() - INTERVAL '${interval}'`;

    // My profile for personal context
    const profRes = await query(`SELECT points, xp_this_month, trust_score, trust_level, fraud_score, team_id FROM collaborator_profiles WHERE user_id=$1`, [uid]);
    const prof = profRes.rows[0] || {};
    const level = getBusinessLevel(prof.points || 0);

    const [
      activeHuntersRes, dealsSubmittedRes, dealsVerifiedRes,
      avgRoiRes, newReferralsRes, walletTotalRes, xpGenRes,
      missionsRes, coursesRes, chartDealsRes, myTeamRes,
    ] = await Promise.all([
      query(`SELECT COUNT(*) FROM collaborator_profiles WHERE is_active=true AND updated_at >= NOW() - INTERVAL '${interval}'`),
      query(`SELECT COUNT(*) FROM submitted_deals WHERE user_id=$1 ${dateFilter}`, [uid]),
      query(`SELECT COUNT(*) FROM submitted_deals WHERE user_id=$1 AND status IN ('verified','approved') ${dateFilter}`, [uid]),
      query(`SELECT ROUND(AVG(roi_percent)::numeric,1) AS avg FROM submitted_deals WHERE user_id=$1 AND roi_percent IS NOT NULL`, [uid]),
      query(`SELECT COUNT(*) FROM referral_events WHERE referrer_id=$1 ${dateFilter}`, [uid]),
      query(`SELECT COALESCE(points_available,0)+COALESCE(points_pending,0) AS total FROM contributor_wallets WHERE user_id=$1`, [uid]),
      query(`SELECT COALESCE(SUM(xp_delta),0) AS total FROM hunter_transactions WHERE user_id=$1 AND status='approved' ${dateFilter}`, [uid]),
      query(`SELECT COUNT(*) FROM business_mission_progress mp JOIN business_missions m ON m.id=mp.mission_id WHERE mp.user_id=$1 AND mp.completed=true ${dateFilter.replace('created_at','mp.completed_at')}`, [uid]),
      query(`SELECT COUNT(*) FROM university_certificates WHERE user_id=$1`, [uid]),
      // Chart data: deals per day for last 14 days
      query(`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS deals
        FROM submitted_deals WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '14 days'
        GROUP BY day ORDER BY day
      `, [uid]),
      // Team stats (if team member)
      prof.team_id ? query(`
        SELECT t.name, COUNT(tm.id) FILTER (WHERE tm.is_active) AS member_count,
               COALESCE(SUM(cp.points),0) AS total_xp,
               COALESCE(SUM(cp.approved_deals_count),0) AS total_deals
        FROM teams t
        LEFT JOIN team_members tm ON tm.team_id=t.id
        LEFT JOIN collaborator_profiles cp ON cp.user_id=tm.user_id AND tm.is_active=true
        WHERE t.id=$1 GROUP BY t.id,t.name
      `, [prof.team_id]) : Promise.resolve({ rows: [] }),
    ]);

    res.json({
      period,
      profile: { level: level.name, tier: level.tier, trust_level: prof.trust_level || 'Normal', fraud_score: prof.fraud_score || 0 },
      kpis: {
        active_hunters:     parseInt(activeHuntersRes.rows[0]?.count || 0),
        deals_submitted:    parseInt(dealsSubmittedRes.rows[0]?.count || 0),
        deals_verified:     parseInt(dealsVerifiedRes.rows[0]?.count || 0),
        avg_roi:            parseFloat(avgRoiRes.rows[0]?.avg || 0),
        new_referrals:      parseInt(newReferralsRes.rows[0]?.count || 0),
        wallet_points:      parseInt(walletTotalRes.rows[0]?.total || 0),
        xp_generated:       parseInt(xpGenRes.rows[0]?.total || 0),
        missions_completed: parseInt(missionsRes.rows[0]?.count || 0),
        courses_completed:  parseInt(coursesRes.rows[0]?.count || 0),
      },
      chart_deals: chartDealsRes.rows,
      team: myTeamRes.rows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/crm ─────────────────────────────────────────────────────
router.get('/crm', async (req, res) => {
  try {
    const uid    = req.user.id;
    const filter = req.query.filter || 'all'; // all, active, inactive, top
    const search = req.query.search ? String(req.query.search).slice(0, 60) : null;

    // Check user is a team leader
    const leaderRes = await query(
      `SELECT tm.team_id FROM team_members tm WHERE tm.user_id=$1 AND tm.role='owner' AND tm.is_active=true LIMIT 1`,
      [uid]
    );
    if (!leaderRes.rows[0]) {
      return res.json({ members: [], is_leader: false, team: null });
    }
    const teamId = leaderRes.rows[0].team_id;

    const teamRes = await query(`SELECT id, name, slug, city, points FROM teams WHERE id=$1`, [teamId]);

    const params = [teamId];
    let filterWhere = '';
    if (filter === 'active')   filterWhere = `AND cp.updated_at >= NOW() - INTERVAL '7 days'`;
    if (filter === 'inactive') filterWhere = `AND cp.updated_at < NOW() - INTERVAL '7 days'`;
    if (filter === 'top')      filterWhere = `AND cp.points >= 100`;
    let searchWhere = '';
    if (search) { params.push(`%${search}%`); searchWhere = `AND (LOWER(cp.display_name) LIKE LOWER($${params.length}) OR LOWER(u.email) LIKE LOWER($${params.length}))`; }

    const membersRes = await query(`
      SELECT
        cp.user_id, COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS name,
        u.email, cp.points AS xp, cp.xp_this_month, cp.trust_score, cp.trust_level,
        cp.fraud_score, cp.approved_deals_count AS deals_verified,
        cp.pending_deals_count AS deals_pending, cp.scan_count,
        cp.suspicious_activity, cp.updated_at AS last_active,
        w.points_available, w.credit_balance,
        tm.role, tm.joined_at,
        COUNT(DISTINCT uc.id) AS courses_completed,
        COUNT(DISTINCT re.id) AS referrals_made
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      LEFT JOIN collaborator_profiles cp ON cp.user_id = tm.user_id
      LEFT JOIN contributor_wallets w ON w.user_id = tm.user_id
      LEFT JOIN university_certificates uc ON uc.user_id = tm.user_id
      LEFT JOIN referral_events re ON re.referrer_id = tm.user_id
      WHERE tm.team_id=$1 AND tm.is_active=true AND tm.user_id != $1
        ${filterWhere} ${searchWhere}
      GROUP BY cp.user_id, cp.display_name, u.name, u.email, cp.points, cp.xp_this_month,
               cp.trust_score, cp.trust_level, cp.fraud_score, cp.approved_deals_count,
               cp.pending_deals_count, cp.scan_count, cp.suspicious_activity, cp.updated_at,
               w.points_available, w.credit_balance, tm.role, tm.joined_at
      ORDER BY cp.points DESC NULLS LAST
      LIMIT 100
    `, params);

    res.json({
      is_leader: true,
      team: teamRes.rows[0] || null,
      members: membersRes.rows,
      filter,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/wallet/withdraw ────────────────────────────────────────
router.post('/wallet/withdraw', async (req, res) => {
  try {
    const uid = req.user.id;
    const { amount, payment_method, payment_detail } = req.body;

    const amountF = parseFloat(amount);
    if (!amountF || amountF < 10) {
      return res.status(400).json({ error: 'Minimum withdrawal is $10.00' });
    }
    const validMethods = ['paypal', 'venmo', 'zelle', 'ach'];
    if (!validMethods.includes(payment_method)) {
      return res.status(400).json({ error: 'payment_method must be paypal, venmo, zelle, or ach' });
    }
    if (!payment_detail?.trim()) {
      return res.status(400).json({ error: 'payment_detail required (your PayPal email, Venmo @, etc)' });
    }

    // Check available balance
    await query(`INSERT INTO contributor_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [uid]);
    const walletRes = await query(`SELECT credit_balance, available_balance FROM contributor_wallets WHERE user_id=$1`, [uid]);
    const w = walletRes.rows[0] || {};
    const available = parseFloat(w.available_balance || w.credit_balance || 0);

    if (amountF > available) {
      return res.status(402).json({ error: `Insufficient balance. Available: $${available.toFixed(2)}` });
    }

    // Check no pending payout already
    const pending = await query(`SELECT id FROM payout_requests WHERE user_id=$1 AND status='pending' LIMIT 1`, [uid]);
    if (pending.rows[0]) {
      return res.status(409).json({ error: 'You already have a pending payout request.' });
    }

    const pointsUsed = Math.round(amountF * 100);

    // Deduct balance
    await query(`
      UPDATE contributor_wallets
      SET available_balance = available_balance - $1,
          credit_balance    = GREATEST(0, credit_balance - $1),
          pending_balance   = pending_balance + $1,
          updated_at = NOW()
      WHERE user_id = $2
    `, [amountF, uid]);

    const payoutRes = await query(`
      INSERT INTO payout_requests (user_id, amount, points_used, payment_method, payment_detail)
      VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at
    `, [uid, amountF, pointsUsed, payment_method, payment_detail.trim()]);

    // Log transaction
    await query(`
      INSERT INTO hunter_transactions (user_id, type, source, amount_delta, status, description)
      VALUES ($1, 'withdrawal', 'wallet', $2, 'pending', $3)
    `, [uid, -amountF, `Withdrawal via ${payment_method} — pending approval`]);

    const { notify } = require('../services/hunterNotifications');
    notify(uid, 'withdrawal_requested', 'Retiro solicitado', `Tu solicitud de $${amountF.toFixed(2)} vía ${payment_method} está en revisión.`).catch(() => {});

    res.json({
      requested: true,
      payout_id: payoutRes.rows[0].id,
      amount: amountF,
      status: 'pending',
      message: `Withdrawal of $${amountF.toFixed(2)} submitted. Usually processed within 3–5 business days.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/wallet/payouts ─────────────────────────────────────────
router.get('/wallet/payouts', async (req, res) => {
  try {
    const uid = req.user.id;
    const result = await query(
      `SELECT id, amount, status, payment_method, requested_at, approved_at, paid_at, admin_notes
       FROM payout_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [uid]
    );
    res.json({ payouts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/notifications ──────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  try {
    const uid   = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 30, 50);
    const onlyUnread = req.query.unread === 'true';

    const result = await query(
      `SELECT id, type, title, message, metadata, read, created_at
       FROM hunter_notifications
       WHERE user_id=$1 ${onlyUnread ? 'AND read=false' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      [uid, limit]
    );
    const unreadCount = await query(
      `SELECT COUNT(*) FROM hunter_notifications WHERE user_id=$1 AND read=false`,
      [uid]
    );
    res.json({
      notifications: result.rows,
      unread_count: parseInt(unreadCount.rows[0]?.count || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/notifications/read-all ─────────────────────────────────
router.post('/notifications/read-all', async (req, res) => {
  try {
    await query(`UPDATE hunter_notifications SET read=true WHERE user_id=$1 AND read=false`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/business/notifications/:id/read ──────────────────────────────────
router.put('/notifications/:id/read', async (req, res) => {
  try {
    await query(
      `UPDATE hunter_notifications SET read=true WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getBusinessLevel = getBusinessLevel;

const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const logger = require('../utils/logger');

// ── Level system ───────────────────────────────────────────────────────────────
const LEVELS = [
  { name: 'Hunter',            tier: 1, min: 0,     next: 1000  },
  { name: 'Líder',             tier: 2, min: 1000,  next: 5000  },
  { name: 'Director Regional', tier: 3, min: 5000,  next: 20000 },
  { name: 'Director Nacional', tier: 4, min: 20000, next: null  },
];

function getLevel(xp) {
  const pts = xp || 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (pts >= LEVELS[i].min) return LEVELS[i].name;
  }
  return LEVELS[0].name;
}

// ── Optional auth (all endpoints are public) ──────────────────────────────────
function tryGetUserId(req) {
  try {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      const p   = jwt.verify(h.slice(7), process.env.JWT_SECRET);
      return p.id || p.userId || p.sub || null;
    }
  } catch (_) {}
  return null;
}

// ── Hunter query helper ────────────────────────────────────────────────────────
async function fetchHunters({ period = 'all_time', city = null, state = null, limit = 50 } = {}) {
  const p = [];
  const cityWhere  = city  ? `AND LOWER(cp.city)  = LOWER($${p.push(city)})` : '';
  const stateWhere = state ? `AND LOWER(cp.state) = LOWER($${p.push(state)})` : '';
  const lim = p.push(limit);

  if (period === 'week') {
    return query(`
      WITH pd AS (
        SELECT user_id, COALESCE(SUM(xp_delta), 0) AS pxp
        FROM hunter_transactions
        WHERE created_at >= date_trunc('week', NOW()) AND status = 'approved'
        GROUP BY user_id
      )
      SELECT
        cp.user_id,
        COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS name,
        cp.city, cp.state,
        cp.points AS xp,
        COALESCE(pd.pxp, 0) AS period_xp,
        cp.trust_score,
        cp.approved_deals_count AS verified_deals,
        cp.scan_count,
        t.name AS team_name,
        COUNT(DISTINCT hb.id)  AS badge_count,
        COUNT(DISTINCT uc.id)  AS courses_completed
      FROM collaborator_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN teams t    ON t.id  = cp.team_id
      LEFT JOIN hunter_badges hb        ON hb.user_id = cp.user_id
      LEFT JOIN university_certificates uc ON uc.user_id = cp.user_id
      LEFT JOIN pd ON pd.user_id = cp.user_id
      WHERE cp.is_active = true ${cityWhere} ${stateWhere}
        AND COALESCE(pd.pxp, 0) > 0
      GROUP BY cp.user_id, cp.display_name, u.name, u.email, cp.city, cp.state,
               cp.points, cp.trust_score, cp.approved_deals_count, cp.scan_count,
               t.name, pd.pxp
      ORDER BY COALESCE(pd.pxp, 0) DESC NULLS LAST
      LIMIT $${lim}
    `, p);
  }

  const scoreExpr = period === 'month' ? 'cp.xp_this_month' : 'cp.points';
  const extraWhere = period === 'month' ? 'AND cp.xp_this_month > 0' : '';

  return query(`
    SELECT
      cp.user_id,
      COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS name,
      cp.city, cp.state,
      cp.points AS xp,
      ${scoreExpr} AS period_xp,
      cp.trust_score,
      cp.approved_deals_count AS verified_deals,
      cp.scan_count,
      t.name AS team_name,
      COUNT(DISTINCT hb.id)  AS badge_count,
      COUNT(DISTINCT uc.id)  AS courses_completed
    FROM collaborator_profiles cp
    JOIN users u ON u.id = cp.user_id
    LEFT JOIN teams t    ON t.id  = cp.team_id
    LEFT JOIN hunter_badges hb        ON hb.user_id = cp.user_id
    LEFT JOIN university_certificates uc ON uc.user_id = cp.user_id
    WHERE cp.is_active = true ${extraWhere} ${cityWhere} ${stateWhere}
    GROUP BY cp.user_id, cp.display_name, u.name, u.email, cp.city, cp.state,
             cp.points, cp.trust_score, cp.approved_deals_count, cp.scan_count,
             t.name, ${scoreExpr}
    ORDER BY ${scoreExpr} DESC NULLS LAST
    LIMIT $${lim}
  `, p);
}

// ── GET /api/business/hall-of-fame ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const uid    = tryGetUserId(req);
    const period = ['week','month','all_time'].includes(req.query.period) ? req.query.period : 'all_time';

    const [huntersRes, teamsRes, citiesRes, dealsRes, referrersRes, learnersRes, risingRes, myRankRes] =
      await Promise.all([
        // Top 10 hunters
        fetchHunters({ period, limit: 10 }),

        // Top 10 teams
        query(`
          SELECT t.id AS team_id, t.name, t.city, t.state,
            COUNT(tm.id) FILTER (WHERE tm.is_active) AS members_count,
            COALESCE(SUM(cp.points), 0)                AS total_xp,
            COALESCE(SUM(cp.approved_deals_count), 0)  AS verified_deals,
            ROUND(AVG(cp.trust_score)::numeric, 1)     AS avg_trust_score,
            COALESCE(leader_cp.display_name, lu.name, split_part(lu.email,'@',1)) AS leader_name
          FROM teams t
          LEFT JOIN team_members tm ON tm.team_id = t.id
          LEFT JOIN collaborator_profiles cp ON cp.user_id = tm.user_id AND tm.is_active = true
          LEFT JOIN team_members tlead ON tlead.team_id = t.id AND tlead.role = 'owner' AND tlead.is_active = true
          LEFT JOIN collaborator_profiles leader_cp ON leader_cp.user_id = tlead.user_id
          LEFT JOIN users lu ON lu.id = tlead.user_id
          WHERE t.is_active = true
          GROUP BY t.id, t.name, t.city, t.state, leader_cp.display_name, lu.name, lu.email
          HAVING COUNT(tm.id) FILTER (WHERE tm.is_active) > 0
          ORDER BY total_xp DESC NULLS LAST
          LIMIT 10
        `),

        // Top 10 cities (from submitted_deals — where deals are actually found)
        query(`
          SELECT
            sd.city,
            sd.state,
            COUNT(DISTINCT sd.user_id) AS hunters_count,
            COUNT(*)                   AS submitted_deals,
            COUNT(*) FILTER (WHERE sd.status IN ('verified','approved')) AS verified_deals,
            ROUND(AVG(sd.roi_percent)::numeric, 1) AS avg_roi
          FROM submitted_deals sd
          WHERE sd.city IS NOT NULL AND sd.city != ''
            AND sd.status NOT IN ('rejected','expired','duplicate')
          GROUP BY sd.city, sd.state
          ORDER BY verified_deals DESC, submitted_deals DESC
          LIMIT 10
        `),

        // Top 10 deals by ROI
        query(`
          SELECT
            sd.id AS deal_id,
            sd.product_name AS title,
            s.name AS store,
            sd.city, sd.state,
            COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS author,
            sd.found_price AS in_store_price,
            sd.effective_market_price AS market_price,
            sd.estimated_profit AS profit,
            sd.roi_percent AS roi,
            sd.opportunity_score AS score,
            COALESCE(sd.confirmation_count, 0) AS confirmations,
            sd.status,
            sd.created_at
          FROM submitted_deals sd
          LEFT JOIN stores s ON s.id = sd.store_id
          LEFT JOIN users u ON u.id = sd.user_id
          LEFT JOIN collaborator_profiles cp ON cp.user_id = sd.user_id
          WHERE sd.status IN ('submitted','pending_confirmation','verified','approved')
            AND sd.roi_percent IS NOT NULL
          ORDER BY sd.roi_percent DESC NULLS LAST, sd.opportunity_score DESC NULLS LAST
          LIMIT 10
        `),

        // Top 10 referrers
        query(`
          SELECT
            re.referrer_id AS user_id,
            COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS name,
            cp.city, cp.state,
            cp.points AS xp,
            COUNT(*) AS total_signups,
            COUNT(*) FILTER (WHERE re.converted_to_paid) AS conversions
          FROM referral_events re
          JOIN users u ON u.id = re.referrer_id
          LEFT JOIN collaborator_profiles cp ON cp.user_id = re.referrer_id
          GROUP BY re.referrer_id, cp.display_name, u.name, u.email, cp.city, cp.state, cp.points
          ORDER BY conversions DESC, total_signups DESC
          LIMIT 10
        `),

        // Top 10 learners (by certificates)
        query(`
          SELECT
            uc_cert.user_id,
            COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS name,
            cp.city, cp.state,
            cp.points AS xp,
            COUNT(DISTINCT uc_cert.id) AS certificates,
            COUNT(DISTINCT up.id) AS lessons_completed
          FROM university_certificates uc_cert
          JOIN users u ON u.id = uc_cert.user_id
          LEFT JOIN collaborator_profiles cp ON cp.user_id = uc_cert.user_id
          LEFT JOIN university_progress up ON up.user_id = uc_cert.user_id AND up.status = 'completed'
          GROUP BY uc_cert.user_id, cp.display_name, u.name, u.email, cp.city, cp.state, cp.points
          ORDER BY certificates DESC, lessons_completed DESC
          LIMIT 10
        `),

        // Top 10 rising stars (best xp_this_month)
        query(`
          SELECT
            cp.user_id,
            COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS name,
            cp.city, cp.state,
            cp.points AS xp,
            cp.xp_this_month AS period_xp,
            cp.trust_score,
            cp.approved_deals_count AS verified_deals
          FROM collaborator_profiles cp
          JOIN users u ON u.id = cp.user_id
          WHERE cp.is_active = true AND cp.xp_this_month > 0
          ORDER BY cp.xp_this_month DESC
          LIMIT 10
        `),

        // My rank (if authenticated)
        uid ? query(`
          SELECT COUNT(*)+1 AS rank
          FROM collaborator_profiles
          WHERE points > COALESCE(
            (SELECT points FROM collaborator_profiles WHERE user_id=$1), 0
          ) AND is_active = true
        `, [uid]) : Promise.resolve({ rows: [{}] }),
      ]);

    const mapRank = (rows) => rows.map((r, i) => ({
      rank:  i + 1,
      level: getLevel(r.xp || 0),
      ...r,
    }));

    res.json({
      period,
      my_rank:       uid ? (parseInt(myRankRes.rows[0]?.rank) || null) : null,
      top_hunters:   mapRank(huntersRes.rows),
      top_teams:     teamsRes.rows.map((r, i) => ({ rank: i + 1, ...r })),
      top_cities:    citiesRes.rows.map((r, i) => ({ rank: i + 1, ...r })),
      top_deals:     dealsRes.rows.map((r, i) => ({ rank: i + 1, ...r })),
      top_referrers: referrersRes.rows.map((r, i) => ({ rank: i + 1, ...r })),
      top_learners:  learnersRes.rows.map((r, i) => ({ rank: i + 1, level: getLevel(r.xp || 0), ...r })),
      rising_stars:  mapRank(risingRes.rows),
    });
  } catch (err) {
    logger.error(`[HallOfFame] GET /: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/hall-of-fame/hunters ────────────────────────────────────
router.get('/hunters', async (req, res) => {
  try {
    const period = ['week','month','all_time'].includes(req.query.period) ? req.query.period : 'all_time';
    const city   = req.query.city  ? String(req.query.city).slice(0, 100)  : null;
    const state  = req.query.state ? String(req.query.state).slice(0, 10)  : null;

    const result = await fetchHunters({ period, city, state, limit: 50 });
    res.json({
      period,
      hunters: result.rows.map((r, i) => ({ rank: i + 1, level: getLevel(r.xp || 0), ...r })),
    });
  } catch (err) {
    logger.error(`[HallOfFame] GET /hunters: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/hall-of-fame/teams ──────────────────────────────────────
router.get('/teams', async (req, res) => {
  try {
    const city  = req.query.city  ? String(req.query.city).slice(0, 100)  : null;
    const state = req.query.state ? String(req.query.state).slice(0, 10)  : null;

    const p = [];
    const cityWhere  = city  ? `AND LOWER(t.city)  = LOWER($${p.push(city)})` : '';
    const stateWhere = state ? `AND LOWER(t.state) = LOWER($${p.push(state)})` : '';

    const result = await query(`
      SELECT t.id AS team_id, t.name, t.city, t.state,
        COUNT(tm.id) FILTER (WHERE tm.is_active) AS members_count,
        COALESCE(SUM(cp.points), 0)                AS total_xp,
        COALESCE(SUM(cp.approved_deals_count), 0)  AS verified_deals,
        COALESCE(SUM(cp.scan_count), 0)            AS total_scans,
        ROUND(AVG(cp.trust_score)::numeric, 1)     AS avg_trust_score,
        COALESCE(leader_cp.display_name, lu.name, split_part(lu.email,'@',1)) AS leader_name
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN collaborator_profiles cp ON cp.user_id = tm.user_id AND tm.is_active = true
      LEFT JOIN team_members tlead ON tlead.team_id = t.id AND tlead.role = 'owner' AND tlead.is_active = true
      LEFT JOIN collaborator_profiles leader_cp ON leader_cp.user_id = tlead.user_id
      LEFT JOIN users lu ON lu.id = tlead.user_id
      WHERE t.is_active = true ${cityWhere} ${stateWhere}
      GROUP BY t.id, t.name, t.city, t.state, leader_cp.display_name, lu.name, lu.email
      HAVING COUNT(tm.id) FILTER (WHERE tm.is_active) > 0
      ORDER BY total_xp DESC NULLS LAST
      LIMIT 50
    `, p);

    res.json({ teams: result.rows.map((r, i) => ({ rank: i + 1, ...r })) });
  } catch (err) {
    logger.error(`[HallOfFame] GET /teams: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/hall-of-fame/cities ─────────────────────────────────────
router.get('/cities', async (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state).slice(0, 10) : null;
    const p = [];
    const stateWhere = state ? `AND LOWER(sd.state) = LOWER($${p.push(state)})` : '';

    const result = await query(`
      SELECT
        sd.city,
        sd.state,
        COUNT(DISTINCT sd.user_id) AS hunters_count,
        COUNT(*)                   AS submitted_deals,
        COUNT(*) FILTER (WHERE sd.status IN ('verified','approved')) AS verified_deals,
        ROUND(AVG(sd.roi_percent)::numeric, 1) AS avg_roi,
        ROUND(AVG(sd.estimated_profit)::numeric, 2) AS avg_profit
      FROM submitted_deals sd
      WHERE sd.city IS NOT NULL AND sd.city != ''
        AND sd.status NOT IN ('rejected','expired','duplicate')
        ${stateWhere}
      GROUP BY sd.city, sd.state
      ORDER BY verified_deals DESC, submitted_deals DESC
      LIMIT 50
    `, p);

    res.json({ cities: result.rows.map((r, i) => ({ rank: i + 1, ...r })) });
  } catch (err) {
    logger.error(`[HallOfFame] GET /cities: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/hall-of-fame/deals ──────────────────────────────────────
router.get('/deals', async (req, res) => {
  try {
    const period = ['week','month','all_time'].includes(req.query.period) ? req.query.period : 'all_time';
    const city   = req.query.city  ? String(req.query.city).slice(0, 100)  : null;
    const state  = req.query.state ? String(req.query.state).slice(0, 10)  : null;

    const p = [];
    let periodWhere = '';
    if (period === 'week')  periodWhere = `AND sd.created_at >= date_trunc('week', NOW())`;
    if (period === 'month') periodWhere = `AND sd.created_at >= date_trunc('month', NOW())`;

    const cityWhere  = city  ? `AND LOWER(sd.city)  = LOWER($${p.push(city)})` : '';
    const stateWhere = state ? `AND LOWER(sd.state) = LOWER($${p.push(state)})` : '';
    p.push(50);

    const result = await query(`
      SELECT
        sd.id AS deal_id,
        LEFT(sd.product_name, 80) AS title,
        s.name AS store,
        sd.city, sd.state,
        COALESCE(cp.display_name, u.name, split_part(u.email,'@',1)) AS author,
        sd.found_price AS in_store_price,
        sd.effective_market_price AS market_price,
        sd.estimated_profit AS profit,
        sd.roi_percent AS roi,
        sd.opportunity_score AS score,
        COALESCE(sd.confirmation_count, 0) AS confirmations,
        sd.status,
        sd.created_at
      FROM submitted_deals sd
      LEFT JOIN stores s ON s.id = sd.store_id
      LEFT JOIN users u ON u.id = sd.user_id
      LEFT JOIN collaborator_profiles cp ON cp.user_id = sd.user_id
      WHERE sd.status IN ('submitted','pending_confirmation','verified','approved')
        AND sd.roi_percent IS NOT NULL
        ${periodWhere} ${cityWhere} ${stateWhere}
      ORDER BY sd.roi_percent DESC NULLS LAST, sd.opportunity_score DESC NULLS LAST
      LIMIT $${p.length}
    `, p);

    res.json({ period, deals: result.rows.map((r, i) => ({ rank: i + 1, ...r })) });
  } catch (err) {
    logger.error(`[HallOfFame] GET /deals: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

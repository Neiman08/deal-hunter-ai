const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All collaborator routes require authentication
router.use(authenticate);

// ── Level helper ──────────────────────────────────────────────────────────────
function getLevel(points) {
  if (points >= 5000) return 'Legend Hunter';
  if (points >= 2500) return 'Elite Hunter';
  if (points >= 1000) return 'Gold Hunter';
  if (points >= 500)  return 'Silver Hunter';
  if (points >= 100)  return 'Bronze Hunter';
  return 'Rookie Hunter';
}

// ── Points award helper ───────────────────────────────────────────────────────
async function awardPoints(collaboratorId, action, pts, description, submittedDealId = null) {
  await query(
    `INSERT INTO collaborator_points_log (collaborator_id, submitted_deal_id, action, points, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [collaboratorId, submittedDealId, action, pts, description]
  );
  const res = await query(
    `UPDATE collaborator_profiles SET points = points + $1, updated_at = NOW()
     WHERE id = $2 RETURNING points`,
    [pts, collaboratorId]
  );
  const newPoints = res.rows[0]?.points || 0;
  const newLevel  = getLevel(newPoints);
  await query(
    `UPDATE collaborator_profiles SET level = $1 WHERE id = $2`,
    [newLevel, collaboratorId]
  );
  return { points: newPoints, level: newLevel };
}

// ── GET /api/collaborators/profile ────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const result = await query(
      `SELECT cp.*, t.name AS team_name, t.slug AS team_slug, t.city AS team_city
       FROM collaborator_profiles cp
       LEFT JOIN teams t ON cp.team_id = t.id
       WHERE cp.user_id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.json({ profile: null });
    }
    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collaborators/profile ──────────────────────────────────────────
router.post('/profile', async (req, res) => {
  try {
    const { display_name } = req.body;
    if (!display_name?.trim()) {
      return res.status(400).json({ error: 'display_name required' });
    }

    // Check if already exists
    const existing = await query(
      'SELECT id FROM collaborator_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'Profile already exists. Use PUT to update.' });
    }

    const result = await query(
      `INSERT INTO collaborator_profiles (user_id, display_name) VALUES ($1, $2) RETURNING *`,
      [req.user.id, display_name.trim()]
    );
    res.status(201).json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/collaborators/profile ────────────────────────────────────────────
router.put('/profile', async (req, res) => {
  try {
    const { display_name } = req.body;
    const result = await query(
      `UPDATE collaborator_profiles SET display_name = COALESCE($1, display_name), updated_at = NOW()
       WHERE user_id = $2 RETURNING *`,
      [display_name?.trim() || null, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collaborators/submit ────────────────────────────────────────────
router.post('/submit', async (req, res) => {
  try {
    const {
      store_id, product_name, brand, sku, upc, product_url,
      image_url, receipt_image_url, shelf_image_url, price_tag_image_url,
      regular_price, found_price, zip_code, city, state, latitude, longitude, notes,
    } = req.body;

    // Validation
    if (!found_price || isNaN(parseFloat(found_price)) || parseFloat(found_price) <= 0) {
      return res.status(400).json({ error: 'found_price is required and must be positive' });
    }
    if (!store_id) {
      return res.status(400).json({ error: 'store_id is required' });
    }
    if (!product_name && !upc && !sku) {
      return res.status(400).json({ error: 'At least product_name, upc, or sku is required' });
    }

    // Get or create collaborator profile
    let profileRes = await query(
      'SELECT id FROM collaborator_profiles WHERE user_id = $1',
      [req.user.id]
    );
    let collaboratorId;
    if (!profileRes.rows[0]) {
      const created = await query(
        `INSERT INTO collaborator_profiles (user_id, display_name) VALUES ($1, $2) RETURNING id`,
        [req.user.id, req.user.name || req.user.email.split('@')[0]]
      );
      collaboratorId = created.rows[0].id;
    } else {
      collaboratorId = profileRes.rows[0].id;
    }

    const fp = parseFloat(found_price);
    const rp = regular_price ? parseFloat(regular_price) : null;
    const discountPct = rp && rp > fp ? Math.round(((rp - fp) / rp) * 100) : null;
    const estimatedProfit = rp && discountPct ? Math.round(fp * 0.65) : null; // rough resale estimate

    // Duplicate detection: same store + (same sku OR same upc) + price within 20%
    let status = 'pending';
    if (sku || upc) {
      const dupeCheck = await query(
        `SELECT id FROM submitted_deals
         WHERE store_id = $1
           AND status NOT IN ('rejected','expired')
           AND (($2::text IS NOT NULL AND sku = $2) OR ($3::text IS NOT NULL AND upc = $3))
           AND ABS(found_price - $4) / GREATEST(found_price, 0.01) < 0.2
         LIMIT 1`,
        [store_id, sku || null, upc || null, fp]
      );
      if (dupeCheck.rows[0]) status = 'duplicate';
    }

    const result = await query(
      `INSERT INTO submitted_deals
         (collaborator_id, user_id, store_id, product_name, brand, sku, upc,
          product_url, image_url, receipt_image_url, shelf_image_url, price_tag_image_url,
          regular_price, found_price, discount_percent, estimated_profit,
          zip_code, city, state, latitude, longitude, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        collaboratorId, req.user.id, store_id, product_name, brand, sku || null, upc || null,
        product_url, image_url, receipt_image_url, shelf_image_url, price_tag_image_url,
        rp, fp, discountPct, estimatedProfit,
        zip_code, city, state, latitude || null, longitude || null, notes, status,
      ]
    );

    const submission = result.rows[0];

    // Award +2 points for submitting
    await awardPoints(collaboratorId, 'submit', 2, 'Deal submitted', submission.id);
    // Award +5 if photo included
    if (image_url || shelf_image_url || price_tag_image_url) {
      await awardPoints(collaboratorId, 'photo', 5, 'Photo evidence provided', submission.id);
    }
    // Award +10 if receipt
    if (receipt_image_url) {
      await awardPoints(collaboratorId, 'receipt', 10, 'Receipt attached', submission.id);
    }

    // Update pending count
    await query(
      `UPDATE collaborator_profiles SET pending_deals_count = pending_deals_count + 1 WHERE id = $1`,
      [collaboratorId]
    );

    // Auto-create feed post if not duplicate
    if (status === 'pending') {
      const storeRes = await query('SELECT name FROM stores WHERE id = $1', [store_id]);
      const storeName = storeRes.rows[0]?.name || '';
      const title = `${product_name || upc || sku} @ ${storeName}${discountPct ? ` — ${discountPct}% off` : ''}`;
      await query(
        `INSERT INTO deal_posts
           (user_id, collaborator_id, submitted_deal_id, store_id, store_name, title, description,
            upc, sku, price, regular_price, discount_percent, estimated_profit,
            zip_code, city, state, latitude, longitude, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending_review')`,
        [
          req.user.id, collaboratorId, submission.id, store_id, storeName,
          title.slice(0, 500), notes || null,
          upc || null, sku || null, fp, rp, discountPct, estimatedProfit,
          zip_code, city, state, latitude || null, longitude || null,
        ]
      );
    }

    res.status(201).json({ submission, status, message: status === 'duplicate' ? 'Possible duplicate detected' : 'Submitted for review' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collaborators/submissions ───────────────────────────────────────
router.get('/submissions', async (req, res) => {
  try {
    const { status, limit = 30, offset = 0 } = req.query;

    const profileRes = await query(
      'SELECT id FROM collaborator_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (!profileRes.rows[0]) return res.json({ submissions: [] });

    let sql = `
      SELECT sd.*, s.name AS store_name, s.color AS store_color
      FROM submitted_deals sd
      LEFT JOIN stores s ON sd.store_id = s.id
      WHERE sd.collaborator_id = $1
    `;
    const params = [profileRes.rows[0].id];
    let idx = 2;

    if (status) {
      sql += ` AND sd.status = $${idx++}`;
      params.push(status);
    }

    sql += ` ORDER BY sd.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);
    res.json({ submissions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collaborators/leaderboard ───────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await query(
      `SELECT cp.id, cp.display_name, cp.level, cp.points,
              cp.approved_deals_count, cp.reputation_score, cp.team_id,
              u.name AS user_name,
              t.name AS team_name,
              ROW_NUMBER() OVER (ORDER BY cp.points DESC) AS rank
       FROM collaborator_profiles cp
       JOIN users u ON cp.user_id = u.id
       LEFT JOIN teams t ON cp.team_id = t.id
       WHERE cp.is_active = true
       ORDER BY cp.points DESC
       LIMIT 50`
    );
    res.json({ leaderboard: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collaborators/teams ─────────────────────────────────────────────
router.get('/teams', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*,
              COUNT(tm.id) FILTER (WHERE tm.is_active = true) AS member_count,
              u.name AS owner_name
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       LEFT JOIN users u ON t.owner_user_id = u.id
       WHERE t.is_active = true
       GROUP BY t.id, u.name
       ORDER BY t.points DESC`
    );
    res.json({ teams: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collaborators/teams ────────────────────────────────────────────
router.post('/teams', async (req, res) => {
  try {
    const { name, city, state, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const result = await query(
      `INSERT INTO teams (name, slug, city, state, description, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name.trim(), slug, city || null, state || null, description || null, req.user.id]
    );
    const team = result.rows[0];

    // Add owner as member
    await query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [team.id, req.user.id]
    );

    // Link collaborator profile to team
    await query(
      `UPDATE collaborator_profiles SET team_id = $1 WHERE user_id = $2`,
      [team.id, req.user.id]
    );

    res.status(201).json({ team });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Team name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collaborators/teams/:id ─────────────────────────────────────────
router.get('/teams/:id', async (req, res) => {
  try {
    const teamRes = await query(
      `SELECT t.*, u.name AS owner_name,
              coach.name AS coach_name, coach.ai_disclosure_label AS coach_label,
              coach.ai_persona AS coach_persona
       FROM teams t
       LEFT JOIN users u ON t.owner_user_id = u.id
       LEFT JOIN users coach ON t.ai_coach_id = coach.id
       WHERE t.slug = $1 OR t.id::text = $1`,
      [req.params.id]
    );
    if (!teamRes.rows[0]) return res.status(404).json({ error: 'Team not found' });
    const team = teamRes.rows[0];

    // Human members only for leaderboard
    const members = await query(
      `SELECT tm.role, tm.joined_at, u.id AS user_id, u.name,
              cp.display_name, cp.level, cp.points, cp.approved_deals_count
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       LEFT JOIN collaborator_profiles cp ON cp.user_id = u.id
       WHERE tm.team_id = $1 AND tm.is_active = true
         AND tm.role != 'ai_coach'
         AND u.is_ai_leader IS NOT TRUE
       ORDER BY cp.points DESC NULLS LAST`,
      [team.id]
    );

    // Active missions with current user's progress
    const missions = await query(
      `SELECT m.*,
              COALESCE(mp.count, 0) AS my_progress,
              mp.completed_at AS my_completed_at
       FROM team_missions m
       LEFT JOIN team_mission_progress mp ON mp.mission_id = m.id AND mp.user_id = $2
       WHERE m.team_id = $1 AND m.is_active = true
         AND (m.ends_at IS NULL OR m.ends_at > NOW())
       ORDER BY m.reward_points DESC`,
      [team.id, req.user.id]
    );

    // Recent activity (last 15)
    const activity = await query(
      `SELECT ta.*, u.name AS user_name, cp.display_name AS user_display_name
       FROM team_activity ta
       LEFT JOIN users u ON ta.user_id = u.id
       LEFT JOIN collaborator_profiles cp ON cp.user_id = ta.user_id
       WHERE ta.team_id = $1
       ORDER BY ta.created_at DESC
       LIMIT 15`,
      [team.id]
    );

    // Stats: today and this week
    const stats = await query(
      `SELECT
        COUNT(*) FILTER (WHERE ta.action_type = 'scan' AND ta.created_at > NOW() - INTERVAL '1 day') AS scans_today,
        COUNT(*) FILTER (WHERE ta.action_type = 'submit_deal' AND ta.created_at > NOW() - INTERVAL '1 day') AS deals_today,
        COUNT(*) FILTER (WHERE ta.action_type = 'verify_deal' AND ta.created_at > NOW() - INTERVAL '1 day') AS verified_today,
        COALESCE(SUM(ta.points_earned) FILTER (WHERE ta.created_at > NOW() - INTERVAL '1 day'), 0) AS points_today,
        COUNT(*) FILTER (WHERE ta.action_type = 'scan' AND ta.created_at > NOW() - INTERVAL '7 days') AS scans_week,
        COUNT(*) FILTER (WHERE ta.action_type = 'submit_deal' AND ta.created_at > NOW() - INTERVAL '7 days') AS deals_week,
        COUNT(*) FILTER (WHERE ta.action_type = 'verify_deal' AND ta.created_at > NOW() - INTERVAL '7 days') AS verified_week,
        COALESCE(SUM(ta.points_earned) FILTER (WHERE ta.created_at > NOW() - INTERVAL '7 days'), 0) AS points_week
       FROM team_activity ta WHERE ta.team_id = $1`,
      [team.id]
    );

    res.json({
      team,
      members: members.rows,
      missions: missions.rows,
      activity: activity.rows,
      stats: stats.rows[0] || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collaborators/teams/:id/join ───────────────────────────────────
router.post('/teams/:id/join', async (req, res) => {
  try {
    const teamRes = await query(
      'SELECT id FROM teams WHERE (slug = $1 OR id::text = $1) AND is_active = true',
      [req.params.id]
    );
    if (!teamRes.rows[0]) return res.status(404).json({ error: 'Team not found' });
    const teamId = teamRes.rows[0].id;

    await query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'hunter')
       ON CONFLICT (team_id, user_id) DO UPDATE SET is_active = true`,
      [teamId, req.user.id]
    );

    await query(
      `UPDATE collaborator_profiles SET team_id = $1 WHERE user_id = $2`,
      [teamId, req.user.id]
    );

    // Log join activity
    await query(
      `INSERT INTO team_activity (team_id, user_id, action_type, description, points_earned)
       VALUES ($1, $2, 'member_joined', $3, 5)`,
      [teamId, req.user.id, `${req.user.name || 'A hunter'} joined the team!`]
    ).catch(() => {});

    res.json({ message: 'Joined team successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collaborators/teams/:id/activity ───────────────────────────────
router.post('/teams/:id/activity', async (req, res) => {
  try {
    const teamRes = await query(
      'SELECT id FROM teams WHERE (slug = $1 OR id::text = $1) AND is_active = true',
      [req.params.id]
    );
    if (!teamRes.rows[0]) return res.status(404).json({ error: 'Team not found' });
    const teamId = teamRes.rows[0].id;

    const { action_type, description, points_earned = 0, metadata } = req.body;
    const VALID_ACTIONS = ['scan', 'submit_deal', 'verify_deal', 'invite_member', 'mission_completed', 'coach_tip'];
    if (!VALID_ACTIONS.includes(action_type)) {
      return res.status(400).json({ error: `Invalid action_type. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    await query(
      `INSERT INTO team_activity (team_id, user_id, action_type, description, points_earned, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [teamId, req.user.id, action_type, description || null, parseInt(points_earned) || 0, metadata ? JSON.stringify(metadata) : null]
    );

    // Update mission progress if applicable
    if (['scan', 'submit_deal', 'verify_deal', 'invite_member'].includes(action_type)) {
      const missionType = action_type === 'scan' ? 'scan_deals'
        : action_type === 'submit_deal' ? 'submit_deals'
        : action_type === 'verify_deal' ? 'verify_deals'
        : 'invite_members';

      const missions = await query(
        `SELECT id, target_count, reward_points FROM team_missions
         WHERE team_id = $1 AND type = $2 AND is_active = true
           AND (ends_at IS NULL OR ends_at > NOW())`,
        [teamId, missionType]
      );

      for (const mission of missions.rows) {
        await query(
          `INSERT INTO team_mission_progress (mission_id, team_id, user_id, count, updated_at)
           VALUES ($1, $2, $3, 1, NOW())
           ON CONFLICT (mission_id, user_id)
           DO UPDATE SET count = team_mission_progress.count + 1, updated_at = NOW()`,
          [mission.id, teamId, req.user.id]
        );

        const prog = await query(
          `SELECT count FROM team_mission_progress WHERE mission_id = $1 AND user_id = $2`,
          [mission.id, req.user.id]
        );

        if (prog.rows[0]?.count >= mission.target_count) {
          await query(
            `UPDATE team_mission_progress SET completed_at = NOW()
             WHERE mission_id = $1 AND user_id = $2 AND completed_at IS NULL`,
            [mission.id, req.user.id]
          );
          await query(
            `INSERT INTO team_activity (team_id, user_id, action_type, description, points_earned)
             VALUES ($1, $2, 'mission_completed', $3, $4)`,
            [teamId, req.user.id,
             `${req.user.name || 'A hunter'} completed a mission!`,
             mission.reward_points]
          ).catch(() => {});
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getLevel = getLevel;
module.exports.awardPoints = awardPoints;

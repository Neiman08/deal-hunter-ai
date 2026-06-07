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
      `SELECT t.*, u.name AS owner_name FROM teams t
       LEFT JOIN users u ON t.owner_user_id = u.id
       WHERE t.id = $1 OR t.slug = $1`,
      [req.params.id]
    );
    if (!teamRes.rows[0]) return res.status(404).json({ error: 'Team not found' });
    const team = teamRes.rows[0];

    const members = await query(
      `SELECT tm.role, tm.joined_at, u.id AS user_id, u.name,
              cp.display_name, cp.level, cp.points, cp.approved_deals_count,
              ROW_NUMBER() OVER (ORDER BY cp.points DESC) AS rank
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       LEFT JOIN collaborator_profiles cp ON cp.user_id = u.id
       WHERE tm.team_id = $1 AND tm.is_active = true
       ORDER BY cp.points DESC NULLS LAST`,
      [team.id]
    );

    res.json({ team, members: members.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collaborators/teams/:id/join ───────────────────────────────────
router.post('/teams/:id/join', async (req, res) => {
  try {
    const teamRes = await query(
      'SELECT id FROM teams WHERE (id = $1 OR slug = $1) AND is_active = true',
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

    res.json({ message: 'Joined team successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getLevel = getLevel;
module.exports.awardPoints = awardPoints;

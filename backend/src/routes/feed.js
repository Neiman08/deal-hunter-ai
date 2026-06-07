const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── Scoring helper ────────────────────────────────────────────────────────────
function calcAiScore(post) {
  let score = 0;
  // Discount component (0-30)
  if (post.discount_percent >= 70) score += 30;
  else if (post.discount_percent >= 50) score += 20;
  else if (post.discount_percent >= 30) score += 10;
  // Profit component (0-20)
  if (post.estimated_profit >= 50) score += 20;
  else if (post.estimated_profit >= 30) score += 15;
  else if (post.estimated_profit >= 10) score += 8;
  // Confidence from reactions (0-30)
  const found = parseInt(post.found_count || 0);
  const notFound = parseInt(post.not_found_count || 0);
  const total = found + notFound;
  if (total > 0) score += Math.round((found / total) * 30);
  // Engagement (0-20)
  const likes = parseInt(post.like_count || 0);
  const comments = parseInt(post.comment_count || 0);
  score += Math.min(20, (likes * 2) + (comments * 3));

  score = Math.min(100, score);
  return score;
}

function calcAiLabel(score, discount) {
  if (score >= 85) return '🔥 Viral Deal';
  if (score >= 70 && discount >= 60) return '💎 Hidden Clearance';
  if (score >= 65 && discount >= 50) return '💰 Reseller Pick';
  if (score >= 60) return '🚀 Hot Deal';
  if (score >= 40 && discount >= 50) return '⚡ Flash Deal';
  return '⚠️ YMMV';
}

// ── Post enrichment query ─────────────────────────────────────────────────────
const POST_SELECT = `
  SELECT
    dp.*,
    u.name AS user_name,
    cp.display_name, cp.level, cp.points AS collaborator_points,
    t.name AS team_name, t.slug AS team_slug,
    s.name AS store_chain, s.color AS store_color, s.logo_url AS store_logo,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'like')       AS like_count,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'hot')        AS hot_count,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'verified')   AS verified_count,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'expired')    AS expired_count,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'not_found')  AS not_found_count,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'bought')     AS bought_count,
    COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction = 'sold')       AS sold_count,
    COUNT(DISTINCT dpc.id)                                             AS comment_count,
    (SELECT COUNT(*) FROM deal_confirmations dc WHERE dc.deal_id = dp.deal_id AND dc.confirmation_type = 'found') AS confirmed_found,
    (SELECT COUNT(*) FROM deal_confirmations dc WHERE dc.deal_id = dp.deal_id AND dc.confirmation_type = 'not_found') AS confirmed_not_found,
    COALESCE(
      (SELECT MAX(dc2.created_at) FROM deal_confirmations dc2 WHERE dc2.deal_id = dp.deal_id),
      dp.created_at
    ) AS last_confirmation_at,
    ARRAY(
      SELECT json_build_object('url', dpi.image_url, 'type', dpi.image_type)
      FROM deal_post_images dpi WHERE dpi.post_id = dp.id
    ) AS images
  FROM deal_posts dp
  LEFT JOIN users u ON dp.user_id = u.id
  LEFT JOIN collaborator_profiles cp ON dp.collaborator_id = cp.id
  LEFT JOIN teams t ON cp.team_id = t.id
  LEFT JOIN stores s ON dp.store_id = s.id
  LEFT JOIN deal_post_reactions dpr ON dpr.post_id = dp.id
  LEFT JOIN deal_post_comments dpc ON dpc.post_id = dp.id
`;

// ── GET /api/feed ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, status = 'active' } = req.query;
    const result = await query(
      `${POST_SELECT}
       WHERE dp.status = $1
       GROUP BY dp.id, u.name, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
       ORDER BY dp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, parseInt(limit), parseInt(offset)]
    );
    const posts = result.rows.map(p => ({
      ...p,
      ai_score: calcAiScore(p),
      ai_label: calcAiLabel(calcAiScore(p), p.discount_percent || 0),
    }));
    res.json({ posts, count: posts.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/feed/trending ────────────────────────────────────────────────────
router.get('/trending', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const result = await query(
      `${POST_SELECT}
       WHERE dp.status = 'active' AND dp.created_at > NOW() - INTERVAL '48 hours'
       GROUP BY dp.id, u.name, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
       HAVING COUNT(DISTINCT dpr.id) > 0 OR COUNT(DISTINCT dpc.id) > 0
       ORDER BY
         (COUNT(DISTINCT dpr.id) FILTER (WHERE dpr.reaction IN ('hot','verified')) * 3
          + COUNT(DISTINCT dpc.id) * 2
          + COALESCE(dp.discount_percent, 0) * 0.3
          + COALESCE(dp.estimated_profit, 0) * 0.1
         ) DESC
       LIMIT $1`,
      [parseInt(limit)]
    );
    const posts = result.rows.map(p => ({
      ...p,
      ai_score: calcAiScore(p),
      ai_label: calcAiLabel(calcAiScore(p), p.discount_percent || 0),
    }));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/feed/latest ──────────────────────────────────────────────────────
router.get('/latest', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const result = await query(
      `${POST_SELECT}
       WHERE dp.status = 'active'
       GROUP BY dp.id, u.name, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
       ORDER BY dp.created_at DESC
       LIMIT $1`,
      [parseInt(limit)]
    );
    const posts = result.rows.map(p => ({
      ...p,
      ai_score: calcAiScore(p),
      ai_label: calcAiLabel(calcAiScore(p), p.discount_percent || 0),
    }));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/feed/store/:slug ─────────────────────────────────────────────────
router.get('/store/:slug', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const result = await query(
      `${POST_SELECT}
       WHERE dp.status = 'active' AND s.slug = $1
       GROUP BY dp.id, u.name, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
       ORDER BY dp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.slug, parseInt(limit), parseInt(offset)]
    );
    const posts = result.rows.map(p => ({
      ...p,
      ai_score: calcAiScore(p),
      ai_label: calcAiLabel(calcAiScore(p), p.discount_percent || 0),
    }));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/feed/zip/:zip ────────────────────────────────────────────────────
router.get('/zip/:zip', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const result = await query(
      `${POST_SELECT}
       WHERE dp.status = 'active' AND dp.zip_code = $1
       GROUP BY dp.id, u.name, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
       ORDER BY dp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.zip, parseInt(limit), parseInt(offset)]
    );
    const posts = result.rows.map(p => ({
      ...p,
      ai_score: calcAiScore(p),
      ai_label: calcAiLabel(calcAiScore(p), p.discount_percent || 0),
    }));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/feed/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `${POST_SELECT}
       WHERE dp.id = $1
       GROUP BY dp.id, u.name, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Post not found' });

    const post = result.rows[0];
    post.ai_score = calcAiScore(post);
    post.ai_label = calcAiLabel(post.ai_score, post.discount_percent || 0);

    // Get comments
    const comments = await query(
      `SELECT dpc.*, u.name AS user_name FROM deal_post_comments dpc
       LEFT JOIN users u ON dpc.user_id = u.id
       WHERE dpc.post_id = $1 ORDER BY dpc.created_at ASC`,
      [post.id]
    );
    post.comments = comments.rows;

    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/feed (create post) ──────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      title, description, store_id, upc, sku, price, regular_price,
      zip_code, city, state, latitude, longitude, images,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    if (!price || parseFloat(price) <= 0) return res.status(400).json({ error: 'price required' });

    const fp = parseFloat(price);
    const rp = regular_price ? parseFloat(regular_price) : null;
    const discountPct = rp && rp > fp ? Math.round(((rp - fp) / rp) * 100) : null;
    const estimatedProfit = rp && discountPct ? Math.round(fp * 0.65) : null;

    // Get collaborator profile if exists
    const cpRes = await query(
      'SELECT id FROM collaborator_profiles WHERE user_id = $1',
      [req.user.id]
    );
    const collaboratorId = cpRes.rows[0]?.id || null;

    const storeRes = store_id ? await query('SELECT name FROM stores WHERE id = $1', [store_id]) : { rows: [] };
    const storeName = storeRes.rows[0]?.name || null;

    const result = await query(
      `INSERT INTO deal_posts
         (user_id, collaborator_id, store_id, store_name, title, description,
          upc, sku, price, regular_price, discount_percent, estimated_profit,
          zip_code, city, state, latitude, longitude, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active')
       RETURNING *`,
      [
        req.user.id, collaboratorId, store_id || null, storeName,
        title.trim().slice(0, 500), description || null,
        upc || null, sku || null, fp, rp, discountPct, estimatedProfit,
        zip_code || null, city || null, state || null, latitude || null, longitude || null,
      ]
    );
    const post = result.rows[0];

    // Save images
    if (Array.isArray(images)) {
      for (const img of images) {
        if (img.url) {
          await query(
            `INSERT INTO deal_post_images (post_id, image_url, image_type) VALUES ($1, $2, $3)`,
            [post.id, img.url, img.type || 'other']
          );
        }
      }
    }

    res.status(201).json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/feed/:id ─────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, description } = req.body;
    const result = await query(
      `UPDATE deal_posts SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         updated_at = NOW()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [title?.trim() || null, description || null, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Post not found or not authorized' });
    res.json({ post: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/feed/:id ──────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `UPDATE deal_posts SET status = 'hidden', updated_at = NOW()
       WHERE id = $1 AND (user_id = $2 OR $3 = true) RETURNING id`,
      [req.params.id, req.user.id, req.user.is_admin]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Post not found or not authorized' });
    res.json({ message: 'Post hidden' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/feed/:id/comment ────────────────────────────────────────────────
router.post('/:id/comment', authenticate, async (req, res) => {
  try {
    const { comment, image_url } = req.body;
    if (!comment?.trim()) return res.status(400).json({ error: 'comment required' });

    const result = await query(
      `INSERT INTO deal_post_comments (post_id, user_id, comment, image_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.user.id, comment.trim().slice(0, 1000), image_url || null]
    );
    res.status(201).json({ comment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/feed/:id/reaction ───────────────────────────────────────────────
router.post('/:id/reaction', authenticate, async (req, res) => {
  try {
    const { reaction } = req.body;
    const valid = ['like','hot','verified','expired','not_found','bought','sold'];
    if (!valid.includes(reaction)) {
      return res.status(400).json({ error: `reaction must be one of: ${valid.join(', ')}` });
    }

    // Toggle: if exists, remove; else add
    const existing = await query(
      'SELECT id FROM deal_post_reactions WHERE post_id = $1 AND user_id = $2 AND reaction = $3',
      [req.params.id, req.user.id, reaction]
    );

    if (existing.rows[0]) {
      await query('DELETE FROM deal_post_reactions WHERE id = $1', [existing.rows[0].id]);
      return res.json({ action: 'removed', reaction });
    }

    await query(
      `INSERT INTO deal_post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)`,
      [req.params.id, req.user.id, reaction]
    );

    // Award +3 points for confirmations to the post owner's collaborator profile
    if (['verified','found'].includes(reaction)) {
      const postRes = await query(
        'SELECT collaborator_id FROM deal_posts WHERE id = $1',
        [req.params.id]
      );
      if (postRes.rows[0]?.collaborator_id) {
        const { awardPoints } = require('./collaborators');
        await awardPoints(postRes.rows[0].collaborator_id, 'confirmation', 3, 'Deal confirmed by user');
      }
    }

    res.json({ action: 'added', reaction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── AI auto-comment templates ─────────────────────────────────────────────────
const AI_COMMENT_TEMPLATES = {
  fba_roi: [
    'Este producto parece interesante para FBA. Antes de comprar, verifica el sales rank y la competencia en Amazon. Si el ROI supera 40%, vale la pena.',
    'Buen hallazgo. Revisa el historial de precio en Keepa — busca al menos 90 días de estabilidad antes de comprar muchas unidades.',
    'Si hay ROI positivo aquí, asegúrate de verificar los fees de Amazon FBA. Para productos < 1 lb, FBA suele ser la mejor opción.',
  ],
  clearance: [
    'Gracias por compartir. Esta publicación suma puntos para tu ranking semanal. ¡Que la comunidad lo verifique rápido!',
    '¡Buen descuento! Si tienes foto de la etiqueta de precio en tienda, súbela — aumenta la confianza de la oferta y acelera la verificación.',
    'Reto del día cumplido si esto supera 30% de descuento. Sigue buscando — los mejores clearance aparecen al final del día.',
  ],
  general: [
    'Buen hallazgo. Si tienes foto de la etiqueta o precio en tienda, súbela para aumentar la confianza de la oferta.',
    'Gracias por publicar. Cada oferta verificada por la comunidad suma puntos a tu wallet. Sigue escaneando.',
    'Esta oferta fue revisada por nuestro sistema. Recuerda confirmar el precio en tienda antes de comprar.',
  ],
};

async function getSetting(key, defaultVal = 'true') {
  try {
    const r = await query('SELECT value FROM ai_leader_settings WHERE key=$1', [key]);
    return r.rows[0]?.value ?? defaultVal;
  } catch { return defaultVal; }
}

async function maybeAutoComment(postId, post) {
  try {
    const enabled = await getSetting('AI_AUTO_COMMENTS_ENABLED');
    if (enabled !== 'true') return;

    const leadersEnabled = await getSetting('AI_LEADERS_ENABLED');
    if (leadersEnabled !== 'true') return;

    // Check daily comment count
    const maxStr = await getSetting('AI_MAX_COMMENTS_PER_DAY', '20');
    const max = parseInt(maxStr) || 20;
    const todayCount = await query(`
      SELECT COUNT(*) FROM deal_post_comments
      WHERE is_ai_comment = true AND created_at >= CURRENT_DATE
    `);
    if (parseInt(todayCount.rows[0].count) >= max) return;

    // Check post is not already commented by AI
    const alreadyCommented = await query(
      `SELECT id FROM deal_post_comments WHERE post_id=$1 AND is_ai_comment=true`,
      [postId]
    );
    if (alreadyCommented.rows.length > 0) return;

    // Choose leader + template based on post content
    let role = 'clearance_mentor';
    let templateKey = 'general';

    const profit = parseFloat(post.estimated_profit || 0);
    const discount = parseFloat(post.discount_percent || 0);

    if (profit > 5) {
      role = 'resale_expert_amazon';
      templateKey = 'fba_roi';
    } else if (discount >= 25) {
      role = 'clearance_mentor';
      templateKey = 'clearance';
    } else {
      role = 'scanner_coach';
      templateKey = 'general';
    }

    const leaderRes = await query(
      `SELECT id, name, ai_disclosure_label FROM users WHERE ai_role=$1 AND is_ai_leader=true AND is_active=true LIMIT 1`,
      [role]
    );
    if (!leaderRes.rows[0]) return;
    const leader = leaderRes.rows[0];

    const templates = AI_COMMENT_TEMPLATES[templateKey];
    const comment = templates[Math.floor(Math.random() * templates.length)];

    await query(`
      INSERT INTO deal_post_comments
        (post_id, user_id, comment, is_ai_comment, ai_leader_id, ai_commenter_name, ai_commenter_label)
      VALUES ($1, $2, $3, true, $2, $4, $5)
    `, [postId, leader.id, comment, leader.name, leader.ai_disclosure_label || 'AI Leader']);
  } catch (err) {
    // Fire-and-forget: never throw
    console.error('[feed] auto-comment error:', err.message);
  }
}

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
    u.is_ai_leader, u.ai_disclosure_label AS user_ai_label, u.avatar_url AS user_avatar_url,
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
       GROUP BY dp.id, u.name, u.is_ai_leader, u.ai_disclosure_label, u.avatar_url, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
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
       GROUP BY dp.id, u.name, u.is_ai_leader, u.ai_disclosure_label, u.avatar_url, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
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
       GROUP BY dp.id, u.name, u.is_ai_leader, u.ai_disclosure_label, u.avatar_url, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
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
       GROUP BY dp.id, u.name, u.is_ai_leader, u.ai_disclosure_label, u.avatar_url, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
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
       GROUP BY dp.id, u.name, u.is_ai_leader, u.ai_disclosure_label, u.avatar_url, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url
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

// ── GET /api/feed/missions ────────────────────────────────────────────────────
router.get('/missions', async (req, res) => {
  try {
    const uid = req.user?.id;
    const r = await query(`
      SELECT m.id, m.slug, m.title, m.description, m.type, m.action, m.target, m.xp_reward,
             COALESCE(mp.progress, 0) AS progress,
             COALESCE(mp.completed, false) AS completed
      FROM business_missions m
      LEFT JOIN business_mission_progress mp
        ON mp.mission_id = m.id AND mp.user_id = $1
        AND (
          (m.type = 'daily'  AND mp.period = CURRENT_DATE) OR
          (m.type = 'weekly' AND mp.period >= date_trunc('week', CURRENT_DATE)::date)
        )
      WHERE m.is_active = true AND m.type IN ('daily','weekly')
      ORDER BY m.type ASC, m.xp_reward DESC
    `, [uid || null]);
    res.json({ missions: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/feed/ai-leaders ──────────────────────────────────────────────────
router.get('/ai-leaders', async (req, res) => {
  try {
    const r = await query(`
      SELECT id, name, ai_role, ai_persona, ai_specialty, ai_disclosure_label, avatar_url,
             (SELECT COUNT(*) FROM deal_posts WHERE user_id=u.id AND is_ai_post=true) AS post_count,
             (SELECT COUNT(*) FROM deal_post_comments WHERE ai_leader_id=u.id AND is_ai_comment=true) AS comment_count
      FROM users u
      WHERE is_ai_leader = true AND is_active = true
      ORDER BY name
    `);
    res.json({ leaders: r.rows });
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
       GROUP BY dp.id, u.name, u.is_ai_leader, u.ai_disclosure_label, u.avatar_url, cp.display_name, cp.level, cp.points, t.name, t.slug, s.name, s.color, s.logo_url`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Post not found' });

    const post = result.rows[0];
    post.ai_score = calcAiScore(post);
    post.ai_label = calcAiLabel(post.ai_score, post.discount_percent || 0);

    // Get comments
    const comments = await query(
      `SELECT dpc.*,
        COALESCE(dpc.ai_commenter_name, u.name) AS user_name,
        dpc.is_ai_comment, dpc.ai_commenter_label,
        u.avatar_url AS user_avatar_url
       FROM deal_post_comments dpc
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

    // Trigger AI auto-comment (fire-and-forget, only for human posts)
    if (!req.user.is_ai_leader) {
      maybeAutoComment(post.id, post).catch(() => {});
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

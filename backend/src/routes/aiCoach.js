const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

router.use(authenticate);

// ── Level system (mirrors business.js) ────────────────────────────────────────
const LEVELS = [
  { name: 'Hunter',            tier: 1, min: 0,     next: 1000  },
  { name: 'Líder',             tier: 2, min: 1000,  next: 5000  },
  { name: 'Director Regional', tier: 3, min: 5000,  next: 20000 },
  { name: 'Director Nacional', tier: 4, min: 20000, next: null  },
];

function getLevel(xp) {
  const pts = xp || 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (pts >= LEVELS[i].min) return LEVELS[i];
  }
  return LEVELS[0];
}

// ── Load user context for coach ────────────────────────────────────────────────
async function loadUserContext(uid) {
  const [profileRes, walletRes, missionsRes, univRes, rankRes] = await Promise.all([
    query(`SELECT points, xp_this_month, trust_score, scan_count, approved_deals_count, pending_deals_count FROM collaborator_profiles WHERE user_id=$1`, [uid]),
    query(`SELECT points_available, points_pending, lifetime_points, credit_balance FROM contributor_wallets WHERE user_id=$1`, [uid]),
    query(`
      SELECT m.slug, m.title, m.type, m.action, m.target, m.xp_reward,
             COALESCE(mp.progress, 0) AS progress,
             COALESCE(mp.completed, false) AS completed
      FROM business_missions m
      LEFT JOIN business_mission_progress mp
        ON mp.mission_id = m.id AND mp.user_id=$1 AND (
          (m.type='daily'     AND mp.period = CURRENT_DATE) OR
          (m.type='weekly'    AND mp.period >= date_trunc('week',  CURRENT_DATE)::date) OR
          (m.type='monthly'   AND mp.period >= date_trunc('month', CURRENT_DATE)::date) OR
          (m.type='permanent' AND mp.period = '2000-01-01')
        )
      WHERE m.is_active = true
    `, [uid]),
    query(`
      SELECT COUNT(*)+1 AS rank FROM collaborator_profiles
      WHERE points > COALESCE((SELECT points FROM collaborator_profiles WHERE user_id=$1), 0)
        AND is_active = true
    `, [uid]),
    query(`
      SELECT
        COUNT(DISTINCT up.course_id) FILTER (WHERE TRUE) AS courses_touched,
        COUNT(DISTINCT up.course_id) FILTER (
          WHERE (SELECT COUNT(*) FROM university_lessons ul WHERE ul.course_id = up.course_id AND ul.is_active=true) =
                (SELECT COUNT(*) FROM university_progress up2 WHERE up2.user_id=$1 AND up2.course_id = up.course_id AND up2.status='completed')
        ) AS courses_completed,
        COUNT(DISTINCT uc.id) AS certificates
      FROM university_progress up
      LEFT JOIN university_certificates uc ON uc.user_id=$1
      WHERE up.user_id=$1
    `, [uid]),
  ]);

  const profile  = profileRes.rows[0]  || {};
  const wallet   = walletRes.rows[0]   || {};
  const missions = missionsRes.rows     || [];
  const globalRank = parseInt(rankRes.rows[0]?.rank || 0);
  const univ     = univRes.rows[0]      || {};

  const xp = parseInt(profile.points || 0);
  const level = getLevel(xp);
  const nextLevel = level.next ? LEVELS.find(l => l.min === level.next) : null;
  const xpToNext  = nextLevel ? nextLevel.min - xp : 0;

  return {
    xp,
    level,
    nextLevel,
    xpToNext,
    profile: {
      trust_score:          parseInt(profile.trust_score || 50),
      scan_count:           parseInt(profile.scan_count || 0),
      approved_deals:       parseInt(profile.approved_deals_count || 0),
      pending_deals:        parseInt(profile.pending_deals_count || 0),
      xp_this_month:        parseInt(profile.xp_this_month || 0),
    },
    wallet: {
      points_available: parseInt(wallet.points_available || 0),
      points_pending:   parseInt(wallet.points_pending   || 0),
      lifetime_points:  parseInt(wallet.lifetime_points  || 0),
      credit_balance:   parseFloat(wallet.credit_balance || 0),
    },
    missions,
    rank: globalRank,
    courses: {
      in_progress:  Math.max(0, parseInt(univ.courses_touched || 0) - parseInt(univ.courses_completed || 0)),
      completed:    parseInt(univ.courses_completed || 0),
      certificates: parseInt(univ.certificates || 0),
    },
  };
}

// ── Rule-based suggestion generator ───────────────────────────────────────────
function generateSuggestions(ctx) {
  const suggs = [];

  // 1. Level gap
  if (ctx.nextLevel && ctx.xpToNext > 0) {
    suggs.push({
      type: 'level_up',
      priority: 1,
      title: `${ctx.xpToNext.toLocaleString()} XP to reach ${ctx.nextLevel.name}`,
      message: `You're ${ctx.xpToNext} XP away from ${ctx.nextLevel.name}. Complete daily missions and University courses to close the gap fast.`,
      action_url: '/business',
    });
  }

  // 2. Incomplete daily missions
  const incompleteDailies = ctx.missions.filter(m => m.type === 'daily' && !m.completed);
  if (incompleteDailies.length > 0) {
    const m = incompleteDailies[0];
    const remaining = m.target - m.progress;
    suggs.push({
      type: 'mission',
      priority: 2,
      title: `Daily mission: ${m.title}`,
      message: `You need ${remaining} more ${remaining === 1 ? 'action' : 'actions'} to complete "${m.title}" and earn ${m.xp_reward} XP today.`,
      action_url: m.action === 'scan_product' ? '/scanner' : '/collaborator/submit',
    });
  }

  // 3. Weekly missions close to complete
  const nearWeekly = ctx.missions.filter(m =>
    m.type === 'weekly' && !m.completed && m.progress > 0 &&
    (m.progress / m.target) >= 0.5
  );
  if (nearWeekly.length > 0) {
    const m = nearWeekly[0];
    suggs.push({
      type: 'mission',
      priority: 3,
      title: `Almost done: ${m.title}`,
      message: `You're at ${m.progress}/${m.target} on "${m.title}" — just ${m.target - m.progress} more to earn ${m.xp_reward} XP!`,
      action_url: '/business',
    });
  }

  // 4. Pending points
  if (ctx.wallet.points_pending > 0) {
    suggs.push({
      type: 'points',
      priority: 4,
      title: `${ctx.wallet.points_pending} points pending verification`,
      message: `Get your submitted deals confirmed by the community. Head to Community and encourage others to verify your deals.`,
      action_url: '/community',
    });
  }

  // 5. Low trust score
  if (ctx.profile.trust_score < 60) {
    suggs.push({
      type: 'trust',
      priority: 3,
      title: 'Boost your trust score',
      message: `Your trust score is ${ctx.profile.trust_score}/100. Confirm accurate deals from other Hunters to raise it. Higher trust = faster deal verification.`,
      action_url: '/community',
    });
  }

  // 6. University courses
  if (ctx.courses.in_progress > 0) {
    suggs.push({
      type: 'university',
      priority: 4,
      title: 'Continue your courses',
      message: `You have ${ctx.courses.in_progress} course${ctx.courses.in_progress > 1 ? 's' : ''} in progress. Complete them to earn XP and certificates.`,
      action_url: '/business/university',
    });
  } else if (ctx.courses.completed === 0) {
    suggs.push({
      type: 'university',
      priority: 3,
      title: 'Start your first course',
      message: 'University courses teach you how to find better deals, use the Scanner, and sell on Amazon. Each course earns you XP and a certificate.',
      action_url: '/business/university',
    });
  }

  // 7. No scans yet
  if (ctx.profile.scan_count === 0) {
    suggs.push({
      type: 'onboarding',
      priority: 2,
      title: 'Try the Scanner',
      message: 'Use the Scanner to check any product barcode for Amazon price, profit potential, and ROI — all in under 3 seconds.',
      action_url: '/scanner',
    });
  }

  return suggs.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

// ── Rule-based chat response ───────────────────────────────────────────────────
function generateAnswer(message, ctx) {
  const msg = message.toLowerCase();

  if (msg.includes('level up') || msg.includes('líder') || msg.includes('lider') ||
      msg.includes('reach') || msg.includes('next level') || msg.includes('subir')) {
    if (ctx.nextLevel) {
      return `You need **${ctx.xpToNext.toLocaleString()} XP** to reach **${ctx.nextLevel.name}**. Here's how to get there fast:\n\n1. **Complete daily missions** — up to 55 XP/day (scan + submit)\n2. **Finish University courses** — 50–120 XP each, take 20–40 min\n3. **Confirm community deals** — +3 XP per confirmation you give\n4. **Submit high-ROI deals** — weekly mission gives +200 XP\n5. **Refer friends** — monthly mission gives +200 XP\n\nAt current pace with daily missions, you can reach ${ctx.nextLevel.name} in ${Math.ceil(ctx.xpToNext / 55)} days of consistent activity.`;
    }
    return `You've reached the maximum level: **${ctx.level.name}**! Focus on maintaining your rank, mentoring your team, and earning more certificates.`;
  }

  if (msg.includes('points') || msg.includes('puntos') || msg.includes('earn') || msg.includes('ganar')) {
    const pending = ctx.wallet.points_pending;
    return `Here's how to earn more points:\n\n1. **Daily scanner missions** (+30 XP for 5 scans)\n2. **Submit deals** — points become available after community confirms them\n3. **Confirm others' deals** — +3 XP per confirmation\n4. **Complete missions** — weekly + monthly missions give the most XP\n5. **University courses** — each completed course awards XP directly\n\nYou currently have **${ctx.wallet.points_available} available points**.${pending > 0 ? ` You also have **${pending} pending** — share your deals in Community to speed up confirmation.` : ''} Keep scanning and submitting to grow your balance!`;
  }

  if (msg.includes('today') || msg.includes('hoy') || msg.includes('what should') || msg.includes('qué debo') || msg.includes('action plan')) {
    const tasks = [];
    const incompleteDailies = ctx.missions.filter(m => m.type === 'daily' && !m.completed);
    if (incompleteDailies.length > 0) {
      const m = incompleteDailies[0];
      tasks.push(`• **${m.title}** — ${m.progress}/${m.target} done, need ${m.target - m.progress} more (+${m.xp_reward} XP)`);
    }
    if (ctx.profile.trust_score < 70) tasks.push(`• **Confirm 3 community deals** to boost your trust score (+9 XP)`);
    tasks.push(`• **Scan 5 products** at your nearest store (+1 XP each + mission XP)`);
    if (ctx.courses.in_progress > 0) tasks.push(`• **Complete a University lesson** to stay on track`);
    if (ctx.wallet.points_pending > 0) tasks.push(`• **Share your deals in Community** — ${ctx.wallet.points_pending} points are pending confirmation`);
    return `Here's your action plan for today:\n\n${tasks.join('\n')}\n\nStick to this and you could earn 50–100 XP today. Consistency is everything!`;
  }

  if (msg.includes('team') || msg.includes('equipo') || msg.includes('recruit') || msg.includes('members')) {
    return `Growing your team:\n\n1. **Share your referral link** (in Business Home) — each active signup earns you mission XP\n2. **Reach Líder level** (1,000 XP) to unlock team creation\n3. **Join an existing team** from the Teams section if you're not ready to lead\n4. **Active teams coordinate hunts** — more stores covered = more deals found\n\n${ctx.level.name === 'Hunter' && ctx.xpToNext > 0 ? `You're ${ctx.xpToNext} XP away from Líder — focus on missions and University first.` : 'You can create or lead a team now. Head to Teams to get started.'}`;
  }

  if (msg.includes('trust') || msg.includes('score') || msg.includes('confianza')) {
    return `Your current trust score is **${ctx.profile.trust_score}/100**.\n\nHow to improve it:\n\n1. **Submit accurate deals** with clear photos\n2. **Confirm deals you've verified in person** (not just guessing)\n3. **Avoid getting deals rejected** — only post real, current prices\n4. **Be consistent** — regular activity over time builds trust\n\nTrust above 70 gives you priority in deal verification and more daily submission capacity. It's one of the most important metrics on the platform.`;
  }

  if (msg.includes('university') || msg.includes('course') || msg.includes('learn') || msg.includes('aprender')) {
    return `Deal Hunter University has **10 courses** covering everything from platform basics to Amazon selling and team leadership.\n\nYour current status:\n- Completed: **${ctx.courses.completed}** courses\n- In progress: **${ctx.courses.in_progress}**\n- Certificates earned: **${ctx.courses.certificates}**\n\nRecommended next course: ${ctx.courses.completed === 0 ? '"How to Use Deal Hunter AI" — start here' : ctx.courses.in_progress > 0 ? 'Continue the course you started' : '"Retail Arbitrage Fundamentals" — great for leveling up your strategy'}\n\nEach course takes 20–45 minutes and earns 50–120 XP + a certificate.`;
  }

  if (msg.includes('scan') || msg.includes('barcode') || msg.includes('scanner') || msg.includes('upc')) {
    return `The Scanner is your most powerful tool. Here's how to get the most from it:\n\n1. **Scan any product barcode** (UPC or SKU) to see Amazon price history\n2. **Enter your found price** to calculate exact profit and ROI\n3. **Look for 🟢 Live Prices** — these are the most reliable\n4. **Check sales rank** — under 100,000 in most categories means it sells regularly\n5. **Submit promising finds** directly from the scan result screen\n\nYou've done **${ctx.profile.scan_count}** scans so far. Each unique scan (with 5-min debounce) earns +1 XP.`;
  }

  if (msg.includes('top 10') || msg.includes('hall of fame') || msg.includes('leaderboard') || msg.includes('ranking') || msg.includes('rank higher') || msg.includes('mi rango') || msg.includes('my rank') || msg.includes('current rank')) {
    const rank = ctx.rank || '?';
    const xpFor10 = ctx.nextLevel ? ctx.xpToNext : 0;
    return `Your current global rank is **#${rank}**.\n\nTo climb the Hall of Fame:\n\n1. **Complete daily missions every day** — up to 55 XP/day compounds fast\n2. **Finish University courses** — 10 courses × avg 80 XP = 800 XP in a weekend\n3. **Submit high-ROI deals** — weekly mission rewards +200 XP for deals ≥ 50% ROI\n4. **Confirm community deals** — +3 XP each, adds up quickly\n5. **Refer active users** — monthly mission gives +200 XP per 2 conversions\n\nConsistency beats sprints. The top 10 all have 1,000+ XP. ${ctx.nextLevel ? `You need ${ctx.xpToNext} more XP to reach ${ctx.nextLevel.name} — that alone would move your rank significantly.` : 'Keep maintaining your position at the top!'}\n\nVisit the **Hall of Fame** from the Business nav to see the full leaderboard.`;
  }

  if (msg.includes('team rank') || msg.includes('team higher') || msg.includes('equipo rank') || msg.includes('my team')) {
    return `To rank your team higher in the Hall of Fame:\n\n1. **Recruit active Hunters** — team XP is the sum of all member XP\n2. **Set weekly team goals** — share them in your team group chat\n3. **Coordinate store visits** — different members covering different stores = more deals\n4. **Help teammates complete missions** — when they earn XP, your team score rises\n5. **Encourage University course completion** — each cert adds to member XP\n\nTeams are ranked by total XP. With 5 active members each doing daily missions, you could earn 275+ XP per week as a team.\n\nCheck the **Teams** section to see your current team ranking.`;
  }

  if (msg.includes('city') || msg.includes('ciudad') || msg.includes('most active') || msg.includes('which city')) {
    return `City activity in Deal Hunter AI is measured by deal submissions and verifications. Cities with more active Hunters naturally produce more deals.\n\nTo make your city rank higher:\n1. **Recruit Hunters in your city** — use your referral link locally\n2. **Submit deals from local stores** — the city field on each deal counts toward city rankings\n3. **Confirm deals in your area** — verification activity also counts\n\nCheck the **Hall of Fame → Cities** tab to see which cities are most active right now and where your city stands.`;
  }

  if (msg.includes('wallet') || msg.includes('points') || msg.includes('cash') || msg.includes('redeem') || msg.includes('dinero')) {
    return `Your current wallet:\n\n- **Available points:** ${ctx.wallet.points_available}\n- **Pending:** ${ctx.wallet.points_pending}\n- **Credit balance:** $${ctx.wallet.credit_balance.toFixed(2)}\n\nPoints become available when your submitted deals are confirmed by the community. Once available, you can redeem them for cash rewards through the Community section.\n\nKeep submitting good deals and confirming others to grow your balance!`;
  }

  // Default
  return `I'm your Deal Hunter Coach! Here are some quick wins for today:\n\n• **Scan products** — every unique scan earns +1 XP (plus mission XP)\n• **Complete missions** — check Business Home for today's active missions\n• **Submit real deals** you find in stores — earn pending points\n• **Confirm others' deals** — +3 XP per confirmation, builds trust\n• **Take University courses** — 10 courses, 50–120 XP each\n\nYou're currently at **${ctx.xp} XP** as a **${ctx.level.name}**.${ctx.nextLevel ? ` ${ctx.xpToNext} XP to reach ${ctx.nextLevel.name}.` : ' You\'re at the top!'}\n\nWhat would you like help with? Try asking: "What should I do today?", "How do I level up?", or "How can I earn more points?"`;
}

// ── GET /api/business/coach/summary ───────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const uid = req.user.id;
    const ctx = await loadUserContext(uid);
    const suggestions = generateSuggestions(ctx);

    res.json({
      level:       ctx.level.name,
      tier:        ctx.level.tier,
      xp:          ctx.xp,
      xp_to_next:  ctx.xpToNext,
      next_level:  ctx.nextLevel?.name || null,
      trust_score: ctx.profile.trust_score,
      scan_count:  ctx.profile.scan_count,
      summary: ctx.nextLevel
        ? `You are ${ctx.xpToNext} XP away from ${ctx.nextLevel.name}. Complete daily missions to reach it faster.`
        : `You've reached the highest level: ${ctx.level.name}. Keep building your team and reputation.`,
      suggestions,
      mode: 'smart_guidance',
    });
  } catch (err) {
    logger.error(`[AICoach] GET /summary: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/coach/suggestions ───────────────────────────────────────
router.get('/suggestions', async (req, res) => {
  try {
    const uid = req.user.id;
    const ctx = await loadUserContext(uid);
    res.json({ suggestions: generateSuggestions(ctx), mode: 'smart_guidance' });
  } catch (err) {
    logger.error(`[AICoach] GET /suggestions: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/coach/ask ──────────────────────────────────────────────
router.post('/ask', async (req, res) => {
  try {
    const uid     = req.user.id;
    const message = (req.body.message || '').trim().slice(0, 500);
    if (!message) return res.status(400).json({ error: 'message required' });

    const ctx      = await loadUserContext(uid);
    const response = generateAnswer(message, ctx);

    // Log interaction (fire-and-forget)
    query(`
      INSERT INTO ai_coach_logs (user_id, prompt, response, intent, context_snapshot)
      VALUES ($1, $2, $3, 'rule_based', $4)
    `, [uid, message, response, JSON.stringify({
      xp: ctx.xp, level: ctx.level.name, trust_score: ctx.profile.trust_score,
    })]).catch(() => {});

    res.json({ response, mode: 'smart_guidance' });
  } catch (err) {
    logger.error(`[AICoach] POST /ask: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

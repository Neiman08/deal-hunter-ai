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
  const [profileRes, walletRes, missionsRes, rankRes, univRes, refRes] = await Promise.all([
    query(`SELECT points, xp_this_month, trust_score, scan_count, approved_deals_count, pending_deals_count, team_id FROM collaborator_profiles WHERE user_id=$1`, [uid]),
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
    query(`
      SELECT
        COUNT(*) AS total_signups,
        COUNT(*) FILTER (WHERE converted_to_paid) AS conversions
      FROM referral_events WHERE referrer_id=$1
    `, [uid]),
  ]);

  const profile  = profileRes.rows[0]  || {};
  const wallet   = walletRes.rows[0]   || {};
  const missions = missionsRes.rows     || [];
  const globalRank = parseInt(rankRes.rows[0]?.rank || 0);
  const univ     = univRes.rows[0]      || {};
  const ref      = refRes.rows[0]       || {};

  // Team data (only if user belongs to one)
  let team = null;
  if (profile.team_id) {
    const teamRes = await query(`
      SELECT t.name, t.city, COUNT(tm.id) FILTER (WHERE tm.is_active) AS member_count,
             COALESCE(SUM(cp.points), 0) AS total_xp,
             RANK() OVER (ORDER BY SUM(cp.points) DESC) AS team_rank
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN collaborator_profiles cp ON cp.user_id = tm.user_id AND tm.is_active = true
      WHERE t.id = $1
      GROUP BY t.id, t.name, t.city
    `, [profile.team_id]).catch(() => ({ rows: [] }));
    team = teamRes.rows[0] || null;
  }

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
    referrals: {
      total_signups: parseInt(ref.total_signups || 0),
      conversions:   parseInt(ref.conversions   || 0),
    },
    team,
  };
}

// ── Rule-based suggestion generator (bilingual) ────────────────────────────────
function generateSuggestions(ctx, lang = 'en') {
  const suggs = [];
  const es = lang === 'es';

  // 1. Level gap
  if (ctx.nextLevel && ctx.xpToNext > 0) {
    suggs.push({
      type: 'level_up',
      priority: 1,
      title: es
        ? `${ctx.xpToNext.toLocaleString()} XP para llegar a ${ctx.nextLevel.name}`
        : `${ctx.xpToNext.toLocaleString()} XP to reach ${ctx.nextLevel.name}`,
      message: es
        ? `Estás a ${ctx.xpToNext} XP de ${ctx.nextLevel.name}. Completa misiones diarias y cursos de Universidad para cerrar la brecha rápido.`
        : `You're ${ctx.xpToNext} XP away from ${ctx.nextLevel.name}. Complete daily missions and University courses to close the gap fast.`,
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
      title: es ? `Misión diaria: ${m.title}` : `Daily mission: ${m.title}`,
      message: es
        ? `Necesitas ${remaining} ${remaining === 1 ? 'acción' : 'acciones'} más para completar "${m.title}" y ganar ${m.xp_reward} XP hoy.`
        : `You need ${remaining} more ${remaining === 1 ? 'action' : 'actions'} to complete "${m.title}" and earn ${m.xp_reward} XP today.`,
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
      title: es ? `Casi listo: ${m.title}` : `Almost done: ${m.title}`,
      message: es
        ? `Vas en ${m.progress}/${m.target} en "${m.title}" — ¡solo ${m.target - m.progress} más para ganar ${m.xp_reward} XP!`
        : `You're at ${m.progress}/${m.target} on "${m.title}" — just ${m.target - m.progress} more to earn ${m.xp_reward} XP!`,
      action_url: '/business',
    });
  }

  // 4. Pending points
  if (ctx.wallet.points_pending > 0) {
    suggs.push({
      type: 'points',
      priority: 4,
      title: es
        ? `${ctx.wallet.points_pending} puntos pendientes de verificación`
        : `${ctx.wallet.points_pending} points pending verification`,
      message: es
        ? 'Consigue que la comunidad confirme tus deals enviados. Ve a Comunidad y anima a otros a verificarlos.'
        : 'Get your submitted deals confirmed by the community. Head to Community and encourage others to verify your deals.',
      action_url: '/community',
    });
  }

  // 5. Low trust score
  if (ctx.profile.trust_score < 60) {
    suggs.push({
      type: 'trust',
      priority: 3,
      title: es ? 'Mejora tu puntuación de confianza' : 'Boost your trust score',
      message: es
        ? `Tu puntuación de confianza es ${ctx.profile.trust_score}/100. Confirma deals precisos de otros Hunters para subirla. Mayor confianza = verificación más rápida.`
        : `Your trust score is ${ctx.profile.trust_score}/100. Confirm accurate deals from other Hunters to raise it. Higher trust = faster deal verification.`,
      action_url: '/community',
    });
  }

  // 6. University courses
  if (ctx.courses.in_progress > 0) {
    suggs.push({
      type: 'university',
      priority: 4,
      title: es ? 'Continúa tus cursos' : 'Continue your courses',
      message: es
        ? `Tienes ${ctx.courses.in_progress} curso${ctx.courses.in_progress > 1 ? 's' : ''} en progreso. Completa para ganar XP y certificados.`
        : `You have ${ctx.courses.in_progress} course${ctx.courses.in_progress > 1 ? 's' : ''} in progress. Complete them to earn XP and certificates.`,
      action_url: '/business/university',
    });
  } else if (ctx.courses.completed === 0) {
    suggs.push({
      type: 'university',
      priority: 3,
      title: es ? 'Comienza tu primer curso' : 'Start your first course',
      message: es
        ? 'Los cursos de Universidad te enseñan a encontrar mejores deals, usar el Escáner y vender en Amazon. Cada curso te da XP y un certificado.'
        : 'University courses teach you how to find better deals, use the Scanner, and sell on Amazon. Each course earns you XP and a certificate.',
      action_url: '/business/university',
    });
  }

  // 7. No scans yet
  if (ctx.profile.scan_count === 0) {
    suggs.push({
      type: 'onboarding',
      priority: 2,
      title: es ? 'Prueba el Escáner' : 'Try the Scanner',
      message: es
        ? 'Usa el Escáner para verificar cualquier código de barras y ver el precio de Amazon, el profit potencial y el ROI — todo en menos de 3 segundos.'
        : 'Use the Scanner to check any product barcode for Amazon price, profit potential, and ROI — all in under 3 seconds.',
      action_url: '/scanner',
    });
  }

  // 8. Team: push user to join or grow team
  if (!ctx.team) {
    suggs.push({
      type: 'team',
      priority: 5,
      title: es ? 'Únete o crea un equipo' : 'Join or create a team',
      message: es
        ? 'Los equipos multiplican tu alcance. Los miembros coordinan visitas a tiendas, comparten hallazgos y escalan el Hall of Fame juntos.'
        : 'Teams multiply your reach. Members coordinate store visits, share finds, and climb the Hall of Fame together.',
      action_url: '/teams',
    });
  } else if (ctx.team && parseInt(ctx.team.member_count || 0) < 3) {
    suggs.push({
      type: 'team',
      priority: 4,
      title: es ? `Haz crecer tu equipo "${ctx.team.name}"` : `Grow your team "${ctx.team.name}"`,
      message: es
        ? `Tu equipo tiene ${ctx.team.member_count} miembro(s). Recluta más Hunters con tu enlace de referido para mejorar el XP y el ranking del equipo.`
        : `Your team has ${ctx.team.member_count} member(s). Recruit more Hunters via your referral link to boost your team's XP and ranking.`,
      action_url: '/referrals',
    });
  }

  // 9. Referral nudge if no conversions yet
  if (ctx.referrals.total_signups === 0) {
    suggs.push({
      type: 'referral',
      priority: 5,
      title: es ? 'Invita a tu primer amigo' : 'Invite your first friend',
      message: es
        ? 'Comparte tu enlace de referido para ganar tiempo Pro, créditos y XP de misión. Cada registro referido cuenta.'
        : 'Share your referral link to earn Pro time, credits, and mission XP. Every referred signup counts.',
      action_url: '/referrals',
    });
  }

  return suggs.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

// ── Rule-based chat response (bilingual) ──────────────────────────────────────
function generateAnswer(message, ctx, lang = 'en') {
  const msg = message.toLowerCase();
  const es  = lang === 'es';

  if (msg.includes('level up') || msg.includes('líder') || msg.includes('lider') ||
      msg.includes('reach') || msg.includes('next level') || msg.includes('subir') ||
      msg.includes('nivel') || msg.includes('siguiente nivel')) {
    if (ctx.nextLevel) {
      return es
        ? `Necesitas **${ctx.xpToNext.toLocaleString()} XP** para llegar a **${ctx.nextLevel.name}**. Así puedes lograrlo rápido:\n\n1. **Completa misiones diarias** — hasta 55 XP/día (escanear + enviar)\n2. **Termina cursos de Universidad** — 50–120 XP cada uno, en 20–40 min\n3. **Confirma deals de la comunidad** — +3 XP por cada confirmación que das\n4. **Envía deals con alto ROI** — la misión semanal da +200 XP\n5. **Refiere amigos** — la misión mensual da +200 XP\n\nCon misiones diarias consistentes, puedes llegar a ${ctx.nextLevel.name} en ${Math.ceil(ctx.xpToNext / 55)} días.`
        : `You need **${ctx.xpToNext.toLocaleString()} XP** to reach **${ctx.nextLevel.name}**. Here's how to get there fast:\n\n1. **Complete daily missions** — up to 55 XP/day (scan + submit)\n2. **Finish University courses** — 50–120 XP each, take 20–40 min\n3. **Confirm community deals** — +3 XP per confirmation you give\n4. **Submit high-ROI deals** — weekly mission gives +200 XP\n5. **Refer friends** — monthly mission gives +200 XP\n\nAt current pace with daily missions, you can reach ${ctx.nextLevel.name} in ${Math.ceil(ctx.xpToNext / 55)} days of consistent activity.`;
    }
    return es
      ? `¡Llegaste al nivel máximo: **${ctx.level.name}**! Enfócate en mantener tu rango, guiar a tu equipo y ganar más certificados.`
      : `You've reached the maximum level: **${ctx.level.name}**! Focus on maintaining your rank, mentoring your team, and earning more certificates.`;
  }

  if (msg.includes('points') || msg.includes('puntos') || msg.includes('earn') || msg.includes('ganar') || msg.includes('más puntos') || msg.includes('more points')) {
    const pending = ctx.wallet.points_pending;
    return es
      ? `Así puedes ganar más puntos:\n\n1. **Misiones diarias de escaneo** (+30 XP por 5 escaneos)\n2. **Envía deals** — los puntos se liberan cuando la comunidad los confirma\n3. **Confirma deals de otros** — +3 XP por confirmación\n4. **Completa misiones** — las misiones semanales y mensuales dan más XP\n5. **Cursos de Universidad** — cada curso completado otorga XP directamente\n\nActualmente tienes **${ctx.wallet.points_available} puntos disponibles**.${pending > 0 ? ` También tienes **${pending} pendientes** — comparte tus deals en Comunidad para acelerar la confirmación.` : ''} ¡Sigue escaneando y enviando!`
      : `Here's how to earn more points:\n\n1. **Daily scanner missions** (+30 XP for 5 scans)\n2. **Submit deals** — points become available after community confirms them\n3. **Confirm others' deals** — +3 XP per confirmation\n4. **Complete missions** — weekly + monthly missions give the most XP\n5. **University courses** — each completed course awards XP directly\n\nYou currently have **${ctx.wallet.points_available} available points**.${pending > 0 ? ` You also have **${pending} pending** — share your deals in Community to speed up confirmation.` : ''} Keep scanning and submitting to grow your balance!`;
  }

  if (msg.includes('today') || msg.includes('hoy') || msg.includes('what should') || msg.includes('qué debo') ||
      msg.includes('qué hacer') || msg.includes('action plan') || msg.includes('plan de acción')) {
    const tasks = [];
    const incompleteDailies = ctx.missions.filter(m => m.type === 'daily' && !m.completed);
    if (incompleteDailies.length > 0) {
      const m = incompleteDailies[0];
      if (es) {
        tasks.push(`• **${m.title}** — ${m.progress}/${m.target} completado, necesitas ${m.target - m.progress} más (+${m.xp_reward} XP)`);
      } else {
        tasks.push(`• **${m.title}** — ${m.progress}/${m.target} done, need ${m.target - m.progress} more (+${m.xp_reward} XP)`);
      }
    }
    if (es) {
      if (ctx.profile.trust_score < 70) tasks.push(`• **Confirma 3 deals de la comunidad** para mejorar tu puntuación de confianza (+9 XP)`);
      tasks.push(`• **Escanea 5 productos** en tu tienda más cercana (+1 XP cada uno + XP de misión)`);
      if (ctx.courses.in_progress > 0) tasks.push(`• **Completa una lección de Universidad** para seguir avanzando`);
      if (ctx.wallet.points_pending > 0) tasks.push(`• **Comparte tus deals en Comunidad** — ${ctx.wallet.points_pending} puntos están pendientes de confirmación`);
      return `Este es tu plan de acción para hoy:\n\n${tasks.join('\n')}\n\n¡Con esto podrías ganar 50–100 XP hoy. La constancia es todo!`;
    } else {
      if (ctx.profile.trust_score < 70) tasks.push(`• **Confirm 3 community deals** to boost your trust score (+9 XP)`);
      tasks.push(`• **Scan 5 products** at your nearest store (+1 XP each + mission XP)`);
      if (ctx.courses.in_progress > 0) tasks.push(`• **Complete a University lesson** to stay on track`);
      if (ctx.wallet.points_pending > 0) tasks.push(`• **Share your deals in Community** — ${ctx.wallet.points_pending} points are pending confirmation`);
      return `Here's your action plan for today:\n\n${tasks.join('\n')}\n\nStick to this and you could earn 50–100 XP today. Consistency is everything!`;
    }
  }

  if (msg.includes('team') || msg.includes('equipo') || msg.includes('recruit') || msg.includes('members') ||
      msg.includes('miembros') || msg.includes('crecer equipo') || msg.includes('grow')) {
    if (ctx.team) {
      return es
        ? `Tu equipo **"${ctx.team.name}"** tiene **${ctx.team.member_count} miembro(s) activo(s)** con un total de **${parseInt(ctx.team.total_xp || 0).toLocaleString()} XP**.\n\nCómo hacer crecer tu equipo:\n\n1. **Comparte tu enlace de referido** — cada registro que se une sube el XP del equipo\n2. **Establece metas semanales** — coordina visitas a tiendas distintas\n3. **Ayuda a tus compañeros a completar misiones** — su XP cuenta para el total del equipo\n4. **Fomenta completar cursos de Universidad** — cada certificado agrega XP\n\nLos equipos se clasifican en el Hall of Fame por XP total. ¡Con 5 miembros activos haciendo misiones diarias, tu equipo podría ganar 275+ XP/semana!`
        : `Your team **"${ctx.team.name}"** has **${ctx.team.member_count} active member(s)** with a combined **${parseInt(ctx.team.total_xp || 0).toLocaleString()} XP**.\n\nTo grow your team:\n\n1. **Share your referral link** — each signup who joins your team boosts your team XP\n2. **Set weekly goals** — coordinate store visits across different stores\n3. **Help teammates complete missions** — their XP counts toward the team total\n4. **Encourage University completion** — each certificate adds to member XP\n\nTeams are ranked in the Hall of Fame by total XP. With 5 active members doing daily missions, your team could earn 275+ XP/week.`;
    }
    return es
      ? `Cómo hacer crecer tu equipo:\n\n1. **Comparte tu enlace de referido** (en Inicio Negocio) — cada registro activo te da XP de misión\n2. **Llega al nivel Líder** (1.000 XP) para crear un equipo\n3. **Únete a un equipo existente** en la sección Equipos si aún no estás listo para liderar\n4. **Los equipos activos coordinan cacerías** — más tiendas cubiertas = más deals encontrados\n\n${ctx.level.name === 'Hunter' && ctx.xpToNext > 0 ? `Estás a ${ctx.xpToNext} XP de Líder — enfócate primero en las misiones y la Universidad.` : 'Ya puedes crear o liderar un equipo. Ve a Equipos para comenzar.'}`
      : `Growing your team:\n\n1. **Share your referral link** (in Business Home) — each active signup earns you mission XP\n2. **Reach Líder level** (1,000 XP) to unlock team creation\n3. **Join an existing team** from the Teams section if you're not ready to lead\n4. **Active teams coordinate hunts** — more stores covered = more deals found\n\n${ctx.level.name === 'Hunter' && ctx.xpToNext > 0 ? `You're ${ctx.xpToNext} XP away from Líder — focus on missions and University first.` : 'You can create or lead a team now. Head to Teams to get started.'}`;
  }

  if (msg.includes('trust') || msg.includes('score') || msg.includes('confianza') || msg.includes('puntuación de confianza')) {
    return es
      ? `Tu puntuación de confianza actual es **${ctx.profile.trust_score}/100**.\n\nCómo mejorarla:\n\n1. **Envía deals precisos** con fotos claras\n2. **Confirma deals que hayas verificado en persona** (no adivines)\n3. **Evita que te rechacen deals** — solo publica precios reales y actuales\n4. **Sé constante** — la actividad regular a lo largo del tiempo genera confianza\n\nUna confianza superior a 70 te da prioridad en la verificación de deals y mayor capacidad diaria de envío. Es una de las métricas más importantes de la plataforma.`
      : `Your current trust score is **${ctx.profile.trust_score}/100**.\n\nHow to improve it:\n\n1. **Submit accurate deals** with clear photos\n2. **Confirm deals you've verified in person** (not just guessing)\n3. **Avoid getting deals rejected** — only post real, current prices\n4. **Be consistent** — regular activity over time builds trust\n\nTrust above 70 gives you priority in deal verification and more daily submission capacity. It's one of the most important metrics on the platform.`;
  }

  if (msg.includes('university') || msg.includes('curso') || msg.includes('course') ||
      msg.includes('learn') || msg.includes('aprender') || msg.includes('universidad')) {
    return es
      ? `Deal Hunter University tiene **10 cursos** que cubren desde los fundamentos de la plataforma hasta la venta en Amazon y el liderazgo de equipos.\n\nTu situación actual:\n- Completados: **${ctx.courses.completed}** cursos\n- En progreso: **${ctx.courses.in_progress}**\n- Certificados: **${ctx.courses.certificates}**\n\nCurso recomendado: ${ctx.courses.completed === 0 ? '"Cómo usar Deal Hunter AI" — empieza aquí' : ctx.courses.in_progress > 0 ? 'Continúa el curso que ya empezaste' : '"Fundamentos de Retail Arbitrage" — ideal para mejorar tu estrategia'}\n\nCada curso toma 20–45 minutos y otorga 50–120 XP + un certificado.`
      : `Deal Hunter University has **10 courses** covering everything from platform basics to Amazon selling and team leadership.\n\nYour current status:\n- Completed: **${ctx.courses.completed}** courses\n- In progress: **${ctx.courses.in_progress}**\n- Certificates earned: **${ctx.courses.certificates}**\n\nRecommended next course: ${ctx.courses.completed === 0 ? '"How to Use Deal Hunter AI" — start here' : ctx.courses.in_progress > 0 ? 'Continue the course you started' : '"Retail Arbitrage Fundamentals" — great for leveling up your strategy'}\n\nEach course takes 20–45 minutes and earns 50–120 XP + a certificate.`;
  }

  if (msg.includes('scan') || msg.includes('barcode') || msg.includes('scanner') || msg.includes('upc') || msg.includes('escáner') || msg.includes('escanear')) {
    return es
      ? `El Escáner es tu herramienta más poderosa. Así puedes sacarle el máximo provecho:\n\n1. **Escanea cualquier código de barras** (UPC o SKU) para ver el historial de precios de Amazon\n2. **Ingresa el precio que encontraste** para calcular el profit exacto y el ROI\n3. **Busca 🟢 Precios en Vivo** — son los más confiables\n4. **Revisa el rango de ventas** — menos de 100.000 en la mayoría de categorías significa que se vende regularmente\n5. **Envía los mejores hallazgos** directamente desde la pantalla de resultados\n\nLlevas **${ctx.profile.scan_count}** escaneos hasta ahora. Cada escaneo único (con 5 min de espera) otorga +1 XP.`
      : `The Scanner is your most powerful tool. Here's how to get the most from it:\n\n1. **Scan any product barcode** (UPC or SKU) to see Amazon price history\n2. **Enter your found price** to calculate exact profit and ROI\n3. **Look for 🟢 Live Prices** — these are the most reliable\n4. **Check sales rank** — under 100,000 in most categories means it sells regularly\n5. **Submit promising finds** directly from the scan result screen\n\nYou've done **${ctx.profile.scan_count}** scans so far. Each unique scan (with 5-min debounce) earns +1 XP.`;
  }

  if (msg.includes('referral') || msg.includes('invite') || msg.includes('refer') || msg.includes('invitar') || msg.includes('referido')) {
    const signups = ctx.referrals.total_signups;
    const convs   = ctx.referrals.conversions;
    return es
      ? `Tus estadísticas de referidos:\n\n- **Total de registros:** ${signups}\n- **Conversiones pagadas:** ${convs}\n\nCómo funcionan las recompensas:\n- 1 conversión → **7 días Pro gratis**\n- 3 conversiones → **1 mes Pro gratis**\n- 5 conversiones → **$10 de crédito**\n- 10 conversiones → **$25 de crédito**\n- 25 conversiones → **Pro de por vida**\n\nMejores formas de compartir:\n1. **Copia tu enlace de referido** desde Inicio Negocio o Referir y Ganar\n2. **Publícalo en grupos de Facebook de revendedores** o servidores de Discord\n3. **Díselo a los habituales de las tiendas** — cualquiera que compre en Best Buy, GameStop, etc. se beneficia de Deal Hunter\n\nCada referido que convierte también cuenta para la **misión mensual de referidos** (+200 XP por 2 conversiones). Ve a **Referir y Ganar** para obtener tu enlace.`
      : `Your referral stats:\n\n- **Total signups:** ${signups}\n- **Paid conversions:** ${convs}\n\nHow the reward tiers work:\n- 1 conversion → **7 days Pro free**\n- 3 conversions → **1 month Pro free**\n- 5 conversions → **$10 account credit**\n- 10 conversions → **$25 account credit**\n- 25 conversions → **Lifetime Pro**\n\nBest ways to share:\n1. **Copy your referral link** from Business Home or the Refer & Earn section\n2. **Post in reseller Facebook groups** or Discord servers\n3. **Tell local store regulars** — anyone who shops at Best Buy, GameStop, etc. benefits from Deal Hunter\n\nEach referral who converts also counts toward the **monthly referral mission** (+200 XP for 2 conversions). Head to the **Refer & Earn** section to grab your link.`;
  }

  if (msg.includes('top 10') || msg.includes('hall of fame') || msg.includes('leaderboard') || msg.includes('ranking') ||
      msg.includes('rank higher') || msg.includes('mi rango') || msg.includes('my rank') || msg.includes('current rank') ||
      msg.includes('posición') || msg.includes('clasificación')) {
    const rank = ctx.rank || '?';
    return es
      ? `Tu rango global actual es **#${rank}**.\n\nCómo subir en el Hall of Fame:\n\n1. **Completa misiones diarias todos los días** — hasta 55 XP/día se acumula rápido\n2. **Termina cursos de Universidad** — 10 cursos × 80 XP promedio = 800 XP en un fin de semana\n3. **Envía deals con alto ROI** — la misión semanal da +200 XP por deals ≥ 50% ROI\n4. **Confirma deals de la comunidad** — +3 XP cada uno, suma mucho\n5. **Refiere usuarios activos** — la misión mensual da +200 XP por 2 conversiones\n\nLa constancia le gana a los sprints. Los top 10 tienen 1.000+ XP. ${ctx.nextLevel ? `Necesitas ${ctx.xpToNext} XP más para llegar a ${ctx.nextLevel.name} — eso solo movería tu rango significativamente.` : '¡Sigue manteniendo tu posición en la cima!'}\n\nVisita el **Hall of Fame** desde la sección Negocio para ver el ranking completo.`
      : `Your current global rank is **#${rank}**.\n\nTo climb the Hall of Fame:\n\n1. **Complete daily missions every day** — up to 55 XP/day compounds fast\n2. **Finish University courses** — 10 courses × avg 80 XP = 800 XP in a weekend\n3. **Submit high-ROI deals** — weekly mission rewards +200 XP for deals ≥ 50% ROI\n4. **Confirm community deals** — +3 XP each, adds up quickly\n5. **Refer active users** — monthly mission gives +200 XP per 2 conversions\n\nConsistency beats sprints. The top 10 all have 1,000+ XP. ${ctx.nextLevel ? `You need ${ctx.xpToNext} more XP to reach ${ctx.nextLevel.name} — that alone would move your rank significantly.` : 'Keep maintaining your position at the top!'}\n\nVisit the **Hall of Fame** from the Business nav to see the full leaderboard.`;
  }

  if (msg.includes('wallet') || msg.includes('cash') || msg.includes('redeem') || msg.includes('dinero') || msg.includes('canjear') || msg.includes('billetera')) {
    return es
      ? `Tu billetera actual:\n\n- **Puntos disponibles:** ${ctx.wallet.points_available}\n- **Pendientes:** ${ctx.wallet.points_pending}\n- **Crédito:** $${ctx.wallet.credit_balance.toFixed(2)}\n\nLos puntos se liberan cuando tus deals enviados son confirmados por la comunidad. Una vez disponibles, puedes canjearlos por recompensas en efectivo a través de la sección Comunidad.\n\n¡Sigue enviando buenos deals y confirmando los de otros para crecer tu saldo!`
      : `Your current wallet:\n\n- **Available points:** ${ctx.wallet.points_available}\n- **Pending:** ${ctx.wallet.points_pending}\n- **Credit balance:** $${ctx.wallet.credit_balance.toFixed(2)}\n\nPoints become available when your submitted deals are confirmed by the community. Once available, you can redeem them for cash rewards through the Community section.\n\nKeep submitting good deals and confirming others to grow your balance!`;
  }

  if (msg.includes('city') || msg.includes('ciudad') || msg.includes('most active') || msg.includes('which city') || msg.includes('qué ciudad')) {
    return es
      ? `La actividad de ciudades en Deal Hunter AI se mide por los deals enviados y verificados. Las ciudades con más cazadores activos naturalmente producen más deals.\n\nCómo hacer subir tu ciudad:\n1. **Recluta cazadores en tu ciudad** — usa tu enlace de referido localmente\n2. **Envía deals de tiendas locales** — el campo de ciudad en cada deal cuenta para el ranking\n3. **Confirma deals en tu área** — la actividad de verificación también cuenta\n\nRevisa la pestaña **Hall of Fame → Ciudades** para ver qué ciudades son más activas ahora.`
      : `City activity in Deal Hunter AI is measured by deal submissions and verifications. Cities with more active Hunters naturally produce more deals.\n\nTo make your city rank higher:\n1. **Recruit Hunters in your city** — use your referral link locally\n2. **Submit deals from local stores** — the city field on each deal counts toward city rankings\n3. **Confirm deals in your area** — verification activity also counts\n\nCheck the **Hall of Fame → Cities** tab to see which cities are most active right now and where your city stands.`;
  }

  // Default
  return es
    ? `¡Hola! Soy tu Coach de Deal Hunter. Aquí tienes algunas ganancias rápidas para hoy:\n\n• **Escanea productos** — cada escaneo único otorga +1 XP (más XP de misión)\n• **Completa misiones** — revisa Inicio Negocio para las misiones activas de hoy\n• **Envía deals reales** que encuentres en tiendas — gana puntos pendientes\n• **Confirma deals de otros** — +3 XP por confirmación, genera confianza\n• **Toma cursos de Universidad** — 10 cursos, 50–120 XP cada uno\n\nEstás actualmente en **${ctx.xp} XP** como **${ctx.level.name}**.${ctx.nextLevel ? ` Te faltan **${ctx.xpToNext} XP** para llegar a **${ctx.nextLevel.name}**.` : ' ¡Estás en el nivel máximo!'}\n\n¿Con qué quieres que te ayude? Prueba preguntando: "¿Qué debo hacer hoy?", "¿Cómo subo de nivel?", o "¿Cómo gano más puntos?"`
    : `I'm your Deal Hunter Coach! Here are some quick wins for today:\n\n• **Scan products** — every unique scan earns +1 XP (plus mission XP)\n• **Complete missions** — check Business Home for today's active missions\n• **Submit real deals** you find in stores — earn pending points\n• **Confirm others' deals** — +3 XP per confirmation, builds trust\n• **Take University courses** — 10 courses, 50–120 XP each\n\nYou're currently at **${ctx.xp} XP** as a **${ctx.level.name}**.${ctx.nextLevel ? ` ${ctx.xpToNext} XP to reach ${ctx.nextLevel.name}.` : ' You\'re at the top!'}\n\nWhat would you like help with? Try asking: "What should I do today?", "How do I level up?", or "How can I earn more points?"`;
}

// ── GET /api/business/coach/summary ───────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const uid      = req.user.id;
    const language = (req.query.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
    const ctx      = await loadUserContext(uid);
    const suggestions = generateSuggestions(ctx, language);

    const summaryText = language === 'es'
      ? ctx.nextLevel
        ? `Estás a ${ctx.xpToNext} XP de ${ctx.nextLevel.name}. Completa misiones diarias para llegar más rápido.`
        : `Llegaste al nivel más alto: ${ctx.level.name}. Sigue construyendo tu equipo y tu reputación.`
      : ctx.nextLevel
        ? `You are ${ctx.xpToNext} XP away from ${ctx.nextLevel.name}. Complete daily missions to reach it faster.`
        : `You've reached the highest level: ${ctx.level.name}. Keep building your team and reputation.`;

    res.json({
      level:       ctx.level.name,
      tier:        ctx.level.tier,
      xp:          ctx.xp,
      xp_to_next:  ctx.xpToNext,
      next_level:  ctx.nextLevel?.name || null,
      trust_score: ctx.profile.trust_score,
      scan_count:  ctx.profile.scan_count,
      summary:     summaryText,
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
    const uid      = req.user.id;
    const language = (req.query.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
    const ctx      = await loadUserContext(uid);
    res.json({ suggestions: generateSuggestions(ctx, language), mode: 'smart_guidance' });
  } catch (err) {
    logger.error(`[AICoach] GET /suggestions: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/coach/ask ──────────────────────────────────────────────
router.post('/ask', async (req, res) => {
  try {
    const uid      = req.user.id;
    const message  = (req.body.message || '').trim().slice(0, 500);
    const language = (req.body.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
    if (!message) return res.status(400).json({ error: 'message required' });

    const ctx      = await loadUserContext(uid);
    const response = generateAnswer(message, ctx, language);

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

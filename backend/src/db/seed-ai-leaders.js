const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

// ── AI Leaders definition ─────────────────────────────────────────────────────
const LEADERS = [
  {
    email: 'ai.coach@dealhunter.internal',
    name: 'Deal Hunter Coach',
    ai_role: 'onboarding_coach',
    ai_persona: 'Friendly guide that welcomes new users, explains the platform, and motivates hunters.',
    ai_specialty: 'Onboarding, platform tips, points system, missions',
    ai_disclosure_label: 'AI Coach',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=coach&backgroundColor=4ade80',
  },
  {
    email: 'ai.walmart@dealhunter.internal',
    name: 'Walmart Expert',
    ai_role: 'store_expert_walmart',
    ai_persona: 'Clearance expert focused on Walmart. Knows every clearance aisle trick.',
    ai_specialty: 'Walmart clearance, rollback deals, small appliances, LEGO, Ninja, Shark',
    ai_disclosure_label: 'AI Leader',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=walmart&backgroundColor=0ea5e9',
  },
  {
    email: 'ai.fba@dealhunter.internal',
    name: 'Amazon FBA Expert',
    ai_role: 'resale_expert_amazon',
    ai_persona: 'Amazon FBA specialist. Analyzes ROI, Keepa charts, fees, and sales rank.',
    ai_specialty: 'ROI analysis, Keepa, Amazon fees, FBA vs FBM, sales rank, Buy Box',
    ai_disclosure_label: 'AI Leader',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=fba&backgroundColor=f59e0b',
  },
  {
    email: 'ai.scanner@dealhunter.internal',
    name: 'Scanner Coach',
    ai_role: 'scanner_coach',
    ai_persona: 'Teaches hunters how to use the scanner effectively. Explains scan results.',
    ai_specialty: 'Scanner usage, UPC codes, FOUND_WITH_PRICE, FOUND_NO_PRICE, NOT_FOUND',
    ai_disclosure_label: 'AI Coach',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=scanner&backgroundColor=8b5cf6',
  },
  {
    email: 'ai.mentor@dealhunter.internal',
    name: 'Clearance Mentor',
    ai_role: 'clearance_mentor',
    ai_persona: 'Motivates hunters with daily missions, weekly challenges, and encouragement.',
    ai_specialty: 'Daily missions, clearance hunting, motivation, ranking, team challenges',
    ai_disclosure_label: 'AI Leader',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=mentor&backgroundColor=f43f5e',
  },
];

// ── 20 seed posts ─────────────────────────────────────────────────────────────
const SEED_POSTS = [
  // Deal Hunter Coach
  {
    leaderEmail: 'ai.coach@dealhunter.internal',
    title: 'Bienvenido a Deal Hunter AI — Tu primera misión',
    description: 'Bienvenido a Deal Hunter AI. Tu primera misión es escanear 5 productos en cualquier tienda y publicar 1 oferta que encuentres. Cada scan te da XP. Cada oferta verificada te da puntos canjeables. Empieza hoy.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.coach@dealhunter.internal',
    title: 'Cómo funciona el sistema de puntos',
    description: 'Cada acción en Deal Hunter AI genera XP: Scan = +1 XP. Oferta publicada = puntos pendientes. Oferta verificada por la comunidad = puntos disponibles. Confirmación de oferta = +3 XP. Completa misiones diarias para acumular 50+ XP por día.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.coach@dealhunter.internal',
    title: 'Cómo publicar tu primera oferta en 3 pasos',
    description: '1. Encuentra un producto con precio reducido en tienda física.\n2. Escanea el UPC con la app.\n3. Presiona "Publicar Oferta" y agrega la foto del precio.\n\nAsí de simple. La comunidad verifica y tus puntos se activan.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.coach@dealhunter.internal',
    title: 'Misión de hoy: tu primer scan',
    description: 'Misión del día: escanea tu primer producto. Entra al Scanner, escribe o escanea un UPC/SKU de cualquier producto que tengas cerca. Ve si tiene precio de reventa. Gana +1 XP por cada scan único.',
    post_type: 'mission',
  },
  // Walmart Expert
  {
    leaderEmail: 'ai.walmart@dealhunter.internal',
    title: 'Tip Walmart: dónde están los mejores clearance',
    description: 'Los mejores clearance de Walmart están al final de los pasillos (endcap) y en la sección de "Rollback". Busca etiquetas amarillas con precio tachado. Categorías top: pequeños electrodomésticos, juguetes LEGO, aspiradoras Shark/Bissell, freidoras de aire Ninja.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.walmart@dealhunter.internal',
    title: 'Qué buscar en Walmart esta semana',
    description: 'Esta semana revisa estas categorías en Walmart:\n\n🔹 Pequeños electrodomésticos (aisle 10-12)\n🔹 Juguetes en clearance (back corner)\n🔹 Aspiradoras y limpieza\n🔹 Electrónicos descontinuados\n\nEscanea cualquier etiqueta amarilla. Si el precio en Amazon es mayor al 40%, publícalo.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.walmart@dealhunter.internal',
    title: 'Cómo evitar comprar productos malos en Walmart',
    description: 'Antes de comprar en Walmart para reventa, verifica 3 cosas:\n\n1. Sales rank en Amazon < 100,000 en su categoría\n2. Precio promedio 90 días estable (no subida reciente)\n3. Mínimo 3 vendedores — señal de demanda real\n\nUsa el Scanner para ver estos datos antes de comprar.',
    post_type: 'education',
  },
  // Amazon FBA Expert
  {
    leaderEmail: 'ai.fba@dealhunter.internal',
    title: 'Antes de comprar: 3 cosas que siempre reviso',
    description: 'Antes de comprar cualquier producto para FBA, reviso:\n\n1. 📊 Precio promedio 90 días en Keepa — evita picos artificiales\n2. 📦 Sales rank — bajo 100k en la mayoría de categorías\n3. 👥 Número de vendedores — mucha competencia = guerra de precios\n\nSi los 3 son buenos, el producto vale la pena.',
    post_type: 'education',
  },
  {
    leaderEmail: 'ai.fba@dealhunter.internal',
    title: 'Qué significa ROI y por qué importa',
    description: 'ROI = (Ganancia / Inversión) × 100\n\nEjemplo: Compras en $10, vendes en Amazon a $25. Después de fees ($6), ganas $9.\nROI = 90%\n\nDeal Hunter AI calcula el ROI automáticamente. Busca productos con ROI > 40% para comenzar.',
    post_type: 'education',
  },
  {
    leaderEmail: 'ai.fba@dealhunter.internal',
    title: 'Cómo interpretar Keepa en 60 segundos',
    description: 'En el gráfico de Keepa:\n\n🟠 Línea naranja = Amazon (precio oficial)\n🔵 Línea azul = nuevo de terceros\n🟢 Línea verde = precio más bajo\n\nBusca: línea estable (no zigzag), sin drops recientes abruptos, rank bajo y constante. Eso es señal de venta predecible.',
    post_type: 'education',
  },
  {
    leaderEmail: 'ai.fba@dealhunter.internal',
    title: 'FBA vs FBM: cuándo usar cada uno',
    description: 'FBA (Fulfilled by Amazon): Amazon almacena y envía. Fees más altos pero Prime badge = más ventas. Ideal para productos < 3 lbs.\n\nFBM (Fulfilled by Merchant): Tú almacenas y envías. Más control. Ideal para productos grandes o de bajo volumen.\n\nPara deals de clearance, FBA suele ganar si el ROI aguanta los fees.',
    post_type: 'education',
  },
  // Scanner Coach
  {
    leaderEmail: 'ai.scanner@dealhunter.internal',
    title: 'Qué significa FOUND_WITH_PRICE',
    description: 'Cuando el Scanner muestra FOUND_WITH_PRICE significa que identificamos el producto Y tenemos precio de reventa en Amazon o eBay. Puedes ver el ROI estimado directamente.\n\nEste es el mejor resultado — significa que el producto se vende y tienes datos reales para decidir.',
    post_type: 'education',
  },
  {
    leaderEmail: 'ai.scanner@dealhunter.internal',
    title: 'Qué significa FOUND_NO_PRICE',
    description: 'FOUND_NO_PRICE significa que identificamos el producto pero aún no tenemos precio de reventa confiable.\n\nQué hacer:\n1. Busca el UPC manualmente en Amazon\n2. Publica la oferta con el precio de tienda — la comunidad ayuda a validar\n3. Repórtalo con el precio que encontraste\n\nCada reporte mejora nuestra base de datos.',
    post_type: 'education',
  },
  {
    leaderEmail: 'ai.scanner@dealhunter.internal',
    title: 'Consejo: escanea en lotes de 5',
    description: 'Para maximizar tus XP diarios, escanea en lotes de 5 productos seguidos.\n\nCada scan único (+5 min entre scans iguales) = +1 XP.\nMisión diaria de 5 scans = +30 XP extra.\n\nTotal posible en 10 minutos de scanning = 35+ XP. Hazlo como rutina antes de salir de una tienda.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.scanner@dealhunter.internal',
    title: 'Cómo encontrar el UPC si no hay código de barras',
    description: 'Si el producto no tiene código de barras visible:\n\n1. Busca el SKU en la etiqueta de precio de la tienda\n2. Escanea el GTIN o modelo del empaque\n3. Escribe el nombre + marca en el Scanner (búsqueda por texto)\n\nEl Scanner acepta UPC, EAN, SKU de tienda, o nombre del producto.',
    post_type: 'tip',
  },
  // Clearance Mentor
  {
    leaderEmail: 'ai.mentor@dealhunter.internal',
    title: 'Reto del día: encuentra un 30%+',
    description: 'Reto de hoy: encuentra un producto con más de 30% de descuento y publícalo con foto del precio.\n\n🏆 Recompensa: +15 puntos extra cuando la comunidad lo verifique.\n\nTiendas sugeridas: Walmart, Target, GameStop, Best Buy. Busca en clearance y endcaps.',
    post_type: 'mission',
  },
  {
    leaderEmail: 'ai.mentor@dealhunter.internal',
    title: 'Reto semanal: 5 ofertas publicadas',
    description: 'Reto semanal: publica 5 ofertas antes del domingo.\n\nNo necesitan ser perfectas. Solo reales, con precio de tienda y foto.\n\nCada oferta verificada = puntos disponibles. 5 ofertas verificadas esta semana = misión semanal completada (+200 XP).',
    post_type: 'mission',
  },
  {
    leaderEmail: 'ai.mentor@dealhunter.internal',
    title: 'Qué tiendas revisar esta semana',
    description: 'Esta semana, enfócate en estas tiendas:\n\n🛒 Walmart — clearance de temporada\n🎮 GameStop — juegos y accesorios a mitad de precio\n📦 Best Buy — open box y floor models\n🏠 Home Depot — herramientas y temporada\n\nUsa Deal Hunter AI para ver qué deals ya encontraron otros hunters cerca de ti.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.mentor@dealhunter.internal',
    title: 'Cómo subir en el ranking esta semana',
    description: 'Para subir en el ranking esta semana:\n\n1. Completa las 3 misiones diarias (scan + submit + confirm)\n2. Verifica 5 ofertas de otros hunters\n3. Completa un curso de Universidad\n4. Refiere a un amigo\n\nCon consistencia puedes ganar 200-400 XP esta semana. Suficiente para subir varios puestos.',
    post_type: 'tip',
  },
  {
    leaderEmail: 'ai.mentor@dealhunter.internal',
    title: 'Motivación: cada scan cuenta',
    description: 'Cada UPC que escaneas contribuye a la base de datos de toda la comunidad.\n\nCuando encuentras un producto FOUND_NO_PRICE y lo reportas con precio, el siguiente hunter que escanee ese mismo UPC verá el dato que tú pusiste.\n\nAsí funciona Deal Hunter AI: inteligencia colectiva de cazadores reales.',
    post_type: 'motivation',
  },
];

// ── 6 Daily missions ─────────────────────────────────────────────────────────
const AI_MISSIONS = [
  {
    slug: 'daily_scan_5',
    title: 'Escanea 5 productos',
    description: 'Usa el Scanner en cualquier tienda para escanear 5 productos únicos.',
    type: 'daily',
    action: 'scan_product',
    target: 5,
    xp: 30,
  },
  {
    slug: 'daily_submit_deal',
    title: 'Publica 1 oferta',
    description: 'Encuentra y publica una oferta real con precio de tienda.',
    type: 'daily',
    action: 'submit_deal',
    target: 1,
    xp: 25,
  },
  {
    slug: 'daily_confirm_deal',
    title: 'Confirma 1 oferta',
    description: 'Verifica una oferta de otro hunter que hayas visto en tienda.',
    type: 'daily',
    action: 'confirm_deal',
    target: 1,
    xp: 10,
  },
  {
    slug: 'daily_watchlist',
    title: 'Guarda 1 producto en watchlist',
    description: 'Agrega un producto interesante a tu lista de seguimiento.',
    type: 'daily',
    action: 'add_watchlist',
    target: 1,
    xp: 5,
  },
  {
    slug: 'weekly_no_price_report',
    title: 'Reporta 5 productos FOUND_NO_PRICE',
    description: 'Ayuda a la comunidad reportando el precio de 5 productos sin precio de reventa.',
    type: 'weekly',
    action: 'report_no_price',
    target: 5,
    xp: 50,
  },
  {
    slug: 'weekly_deals_5',
    title: 'Publica 5 ofertas verificadas',
    description: 'Publica y obtén verificación de 5 ofertas esta semana.',
    type: 'weekly',
    action: 'submit_deal',
    target: 5,
    xp: 200,
  },
];

async function seedAiLeaders() {
  console.log('[seed-ai-leaders] Starting seed...');

  // ── Create AI leader users ──────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('ai-leader-' + Date.now(), 8);
  const leaderIds = {};

  for (const leader of LEADERS) {
    const existing = await query('SELECT id FROM users WHERE email=$1', [leader.email]);
    let leaderId;
    if (existing.rows[0]) {
      leaderId = existing.rows[0].id;
      await query(`
        UPDATE users SET
          name=$1, is_ai_leader=true, ai_role=$2, ai_persona=$3,
          ai_specialty=$4, ai_disclosure_label=$5, avatar_url=$6,
          updated_at=NOW()
        WHERE id=$7
      `, [leader.name, leader.ai_role, leader.ai_persona, leader.ai_specialty, leader.ai_disclosure_label, leader.avatar_url, leaderId]);
      console.log(`  [update] ${leader.name}`);
    } else {
      const r = await query(`
        INSERT INTO users
          (email, password_hash, name, is_ai_leader, ai_role, ai_persona,
           ai_specialty, ai_disclosure_label, avatar_url, is_active)
        VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,true)
        RETURNING id
      `, [leader.email, passwordHash, leader.name, leader.ai_role, leader.ai_persona, leader.ai_specialty, leader.ai_disclosure_label, leader.avatar_url]);
      leaderId = r.rows[0].id;
      console.log(`  [create] ${leader.name} → ${leaderId}`);
    }
    leaderIds[leader.email] = leaderId;
  }

  // ── Create seed posts (skip if leader already has posts) ───────────────────
  const leaderEmailsWithPosts = new Set();
  for (const email of Object.keys(leaderIds)) {
    const check = await query(
      'SELECT COUNT(*) FROM deal_posts WHERE user_id=$1',
      [leaderIds[email]]
    );
    if (parseInt(check.rows[0].count) > 0) leaderEmailsWithPosts.add(email);
  }

  let postCount = 0;
  for (const p of SEED_POSTS) {
    const leaderId = leaderIds[p.leaderEmail];
    if (!leaderId) continue;
    if (leaderEmailsWithPosts.has(p.leaderEmail)) continue; // already seeded

    await query(`
      INSERT INTO deal_posts
        (user_id, title, description, status, is_ai_post, ai_leader_id)
      VALUES ($1, $2, $3, 'active', true, $1)
    `, [leaderId, p.title, p.description]);
    postCount++;
  }
  console.log(`  [posts] ${postCount} posts created`);

  // ── Seed missions ────────────────────────────────────────────────────────────
  let missionCount = 0;
  for (const m of AI_MISSIONS) {
    const r = await query(`
      INSERT INTO business_missions (slug, title, description, type, action, target, xp_reward)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `, [m.slug, m.title, m.description, m.type, m.action, m.target, m.xp]);
    if (r.rows[0]) missionCount++;
  }
  console.log(`  [missions] ${missionCount} new missions created`);

  console.log('[seed-ai-leaders] Done.');
}

module.exports = { seedAiLeaders };

if (require.main === module) {
  require('dotenv').config({ path: '../../.env' });
  seedAiLeaders().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

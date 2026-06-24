// Deterministic content library for AI Leaders V2 — no external AI calls.
// Tips rotate by day-of-year; missions rotate by day-of-week.

const dayOfYear = () => {
  const now = new Date();
  return Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
};
const dayOfWeek = () => new Date().getDay(); // 0=Sun

// ── Per-leader content keyed by ai_role ──────────────────────────────────────
const LEADER = {
  store_expert_walmart: {
    daily_tips: {
      en: [
        "Today check electronics clearance — markdowns appear Monday mornings. Yellow tags = final clearance.",
        "Toy aisle clearance items under $5 have the highest resale ROI when bundled.",
        "Seasonal transitions are gold: post-holiday, back-to-school, summer closeout = 50–75% off.",
        "Rollbacks refresh on Wednesdays. Hit sporting goods and lawn & garden early.",
        "Small appliances clearance is underrated. Ninja, Shark, Instant Pot drop 40%+ before new models.",
        "Home & Garden clearance peaks in early spring and late summer. Check both ends of the aisle.",
        "Electronics clearance moves fast. If you see it, scan it before another hunter grabs it.",
      ],
      es: [
        "Hoy revisa clearance de electrónicos — los markdowns llegan los lunes. Etiquetas amarillas = clearance final.",
        "Los artículos de clearance de juguetes bajo $5 tienen el mayor ROI de reventa en lotes.",
        "Las transiciones de temporada son oro: post-feriados, regreso a clases, cierre de verano = 50–75% de descuento.",
        "Los Rollbacks se renuevan los miércoles. Ve a deportes y jardín temprano.",
        "El clearance de pequeños electrodomésticos está subestimado. Ninja, Shark e Instant Pot bajan 40%+ antes de nuevos modelos.",
        "El clearance de Hogar y Jardín llega fuerte a principios de primavera y finales de verano.",
        "El clearance de electrónicos se mueve rápido. Si lo ves, escanéalo antes de que otro cazador lo tome.",
      ],
    },
    missions: {
      en: [
        { text: "Find a clearance deal with 40%+ discount in Electronics.", type: "scan_deals", target: 1 },
        { text: "Scan 10 clearance items across any department.", type: "scan_deals", target: 10 },
        { text: "Find a toy clearance deal with 50%+ discount.", type: "scan_deals", target: 1 },
        { text: "Verify 3 deals submitted by other team hunters.", type: "verify_deals", target: 3 },
        { text: "Find a deal with ROI over 60% and submit it.", type: "submit_deals", target: 1 },
        { text: "Scan the seasonal clearance aisle — 5 items minimum.", type: "scan_deals", target: 5 },
        { text: "Submit a deal with a shelf photo showing the clearance tag.", type: "submit_deals", target: 1 },
      ],
      es: [
        { text: "Encuentra un deal de clearance con 40%+ de descuento en Electrónicos.", type: "scan_deals", target: 1 },
        { text: "Escanea 10 artículos de clearance en cualquier departamento.", type: "scan_deals", target: 10 },
        { text: "Encuentra un deal de clearance de juguetes con 50%+ de descuento.", type: "scan_deals", target: 1 },
        { text: "Verifica 3 deals enviados por otros cazadores del equipo.", type: "verify_deals", target: 3 },
        { text: "Encuentra un deal con ROI mayor al 60% y envíalo.", type: "submit_deals", target: 1 },
        { text: "Escanea el pasillo de clearance de temporada — mínimo 5 artículos.", type: "scan_deals", target: 5 },
        { text: "Envía un deal con foto del estante mostrando la etiqueta de clearance.", type: "submit_deals", target: 1 },
      ],
    },
    recommendations: {
      en: [
        "Focus on Electronics, Toys, and Home & Garden aisles for the best margins.",
        "Look for yellow clearance tags — not just rollback stickers.",
        "Monday mornings are the best time for fresh markdowns.",
        "Seasonal transitions (post-holiday, back-to-school) bring the deepest discounts.",
      ],
      es: [
        "Enfócate en los pasillos de Electrónicos, Juguetes y Hogar & Jardín para los mejores márgenes.",
        "Busca etiquetas amarillas de clearance — no solo stickers de rollback.",
        "Los lunes por la mañana son el mejor momento para nuevos descuentos.",
        "Las transiciones de temporada traen los mayores descuentos.",
      ],
    },
    welcome: {
      en: "Welcome to Walmart Clearance Crew! 🎯 First mission: scan 5 clearance items in Electronics or Toys. Yellow tags = gold.",
      es: "¡Bienvenido al Walmart Clearance Crew! 🎯 Primera misión: escanea 5 artículos de clearance en Electrónicos o Juguetes. Etiquetas amarillas = oro.",
    },
  },

  store_expert_bestbuy: {
    daily_tips: {
      en: [
        "Open-box deals at Best Buy yield 20–40% savings. Check in-store for condition grades.",
        "Last-gen electronics get heavy markdowns when new models arrive. Focus on TVs and laptops.",
        "Gaming accessories sit in clearance longer — find bundles with controllers or headsets.",
        "Best Buy price-matches competitors. A double-discount opportunity if you time it right.",
        "Refurbished items offer the same quality at 30% less. High ROI with lower risk.",
        "Yellow clearance tags signal final markdown — these sell fast, don't wait.",
        "Small electronics (cables, chargers, speakers) have high ROI when bundled.",
      ],
      es: [
        "Las ofertas Open-box en Best Buy dan 20–40% de ahorro. Revisa las condiciones en tienda.",
        "Los electrónicos de generación anterior bajan fuerte cuando llegan nuevos modelos. TVs y laptops primero.",
        "Los accesorios de gaming permanecen más en clearance — busca combos con controles o audífonos.",
        "Best Buy iguala precios. Una oportunidad de doble descuento si lo aprovechas bien.",
        "Los artículos reacondicionados ofrecen la misma calidad al 30% menos. Alto ROI y menor riesgo.",
        "Las etiquetas amarillas de clearance indican precio final — se venden rápido, no esperes.",
        "Los pequeños electrónicos tienen alto ROI en lotes. Busca clearance por paquetes.",
      ],
    },
    missions: {
      en: [
        { text: "Find an open-box deal with 30%+ discount.", type: "scan_deals", target: 1 },
        { text: "Scan 5 electronics items and check their Keepa prices.", type: "scan_deals", target: 5 },
        { text: "Find a last-gen laptop or TV clearance deal.", type: "scan_deals", target: 1 },
        { text: "Verify 2 electronics deals submitted by other hunters.", type: "verify_deals", target: 2 },
        { text: "Find a gaming accessory deal with ROI over 50%.", type: "scan_deals", target: 1 },
        { text: "Check the clearance section for 3 items under $20.", type: "scan_deals", target: 3 },
        { text: "Submit a deal with full model number, UPC, and photo.", type: "submit_deals", target: 1 },
      ],
      es: [
        { text: "Encuentra un deal Open-box con 30%+ de descuento.", type: "scan_deals", target: 1 },
        { text: "Escanea 5 artículos de electrónicos y verifica sus precios en Keepa.", type: "scan_deals", target: 5 },
        { text: "Encuentra un deal de clearance de laptop o TV de generación anterior.", type: "scan_deals", target: 1 },
        { text: "Verifica 2 deals de electrónicos enviados por otros cazadores.", type: "verify_deals", target: 2 },
        { text: "Encuentra un accesorio de gaming con ROI mayor al 50%.", type: "scan_deals", target: 1 },
        { text: "Revisa la sección de clearance para 3 artículos bajo $20.", type: "scan_deals", target: 3 },
        { text: "Envía un deal con número de modelo completo, UPC y foto.", type: "submit_deals", target: 1 },
      ],
    },
    recommendations: {
      en: [
        "Focus on last-gen electronics and open-box deals for the best margins.",
        "Always scan the UPC — even small items can have surprisingly high ROI.",
        "Check Keepa price history before committing to a deal.",
        "Gaming and TV sections have the best clearance margins.",
      ],
      es: [
        "Enfócate en electrónicos de generación anterior y deals Open-box para los mejores márgenes.",
        "Siempre escanea el UPC — incluso artículos pequeños pueden tener alto ROI.",
        "Revisa Keepa para el historial de precios antes de comprometerte con un deal.",
        "Las secciones de Gaming y TV tienen los mejores márgenes de clearance.",
      ],
    },
    welcome: {
      en: "Welcome to Best Buy Flippers! 📦 Start by scanning open-box deals in Electronics. A clear photo + UPC gets approved faster.",
      es: "¡Bienvenido a Best Buy Flippers! 📦 Empieza escaneando deals Open-box en Electrónicos. Una foto clara + UPC se aprueba más rápido.",
    },
  },

  fba_expert: {
    daily_tips: {
      en: [
        "Before buying, verify FBA fees and net ROI. A high discount doesn't always mean profit.",
        "Check the BSR (Best Seller Rank) — lower rank means faster sales on Amazon.",
        "Keepa price history helps you spot temporary dips vs true clearance. Use it every time.",
        "FBA packaging fees add up. Bundle similar items to spread the cost.",
        "Look for items ranked under 100,000 in their category — those move reliably.",
        "Hazmat and oversized categories have much higher FBA fees. Verify before committing.",
        "A 30% ROI after fees is the minimum for a sustainable FBA flip.",
      ],
      es: [
        "Antes de comprar, verifica los fees de FBA y el ROI neto. Un descuento alto no siempre significa ganancia.",
        "Verifica el BSR (Best Seller Rank) — un ranking más bajo significa ventas más rápidas en Amazon.",
        "El historial de precios de Keepa te ayuda a identificar bajadas temporales vs clearance real.",
        "Los fees de empaquetado FBA se acumulan. Combina artículos similares para distribuir el costo.",
        "Busca artículos con ranking menor a 100,000 en su categoría — esos se mueven con seguridad.",
        "Las categorías Hazmat y de gran tamaño tienen fees FBA mucho más altos. Verifica antes.",
        "Un ROI del 30% después de fees es el mínimo para un flip FBA sostenible.",
      ],
    },
    missions: {
      en: [
        { text: "Find a deal with 35%+ ROI after FBA fees.", type: "scan_deals", target: 1 },
        { text: "Scan 5 items and verify their FBA fees in the calculator.", type: "scan_deals", target: 5 },
        { text: "Find a deal with Amazon BSR under 50,000.", type: "scan_deals", target: 1 },
        { text: "Verify 3 community deals using Keepa data.", type: "verify_deals", target: 3 },
        { text: "Submit a deal with full fee breakdown and ROI.", type: "submit_deals", target: 1 },
        { text: "Find 2 items in the same category for a bundle deal.", type: "scan_deals", target: 2 },
        { text: "Scan a hazmat-free item with ROI over 40%.", type: "scan_deals", target: 1 },
      ],
      es: [
        { text: "Encuentra un deal con 35%+ de ROI después de fees de FBA.", type: "scan_deals", target: 1 },
        { text: "Escanea 5 artículos y verifica sus fees de FBA en la calculadora.", type: "scan_deals", target: 5 },
        { text: "Encuentra un deal con Amazon BSR menor a 50,000.", type: "scan_deals", target: 1 },
        { text: "Verifica 3 deals de la comunidad usando datos de Keepa.", type: "verify_deals", target: 3 },
        { text: "Envía un deal con desglose completo de fees y ROI.", type: "submit_deals", target: 1 },
        { text: "Encuentra 2 artículos en la misma categoría para un deal de lote.", type: "scan_deals", target: 2 },
        { text: "Escanea un artículo sin Hazmat con ROI mayor al 40%.", type: "scan_deals", target: 1 },
      ],
    },
    recommendations: {
      en: [
        "Always calculate ROI after FBA fees — the scanner shows estimated fees.",
        "BSR under 50,000 = reliable sales velocity for most categories.",
        "Use Keepa to confirm the price drop isn't just a coupon or temporary sale.",
        "Avoid categories marked as Hazmat unless you have the required certifications.",
      ],
      es: [
        "Siempre calcula el ROI después de los fees de FBA — el escáner muestra los fees estimados.",
        "BSR menor a 50,000 = velocidad de ventas confiable para la mayoría de las categorías.",
        "Usa Keepa para confirmar que la bajada de precio no es solo un cupón o venta temporal.",
        "Evita las categorías marcadas como Hazmat a menos que tengas las certificaciones requeridas.",
      ],
    },
    welcome: {
      en: "Welcome to the FBA team! 📊 First step: scan a deal and run the fee calculator. ROI after fees is the only number that matters.",
      es: "¡Bienvenido al equipo FBA! 📊 Primer paso: escanea un deal y ejecuta la calculadora de fees. El ROI después de fees es el único número que importa.",
    },
  },
};

// ── Generic fallback for unlisted roles ───────────────────────────────────────
const GENERIC = {
  daily_tips: {
    en: [
      "Focus on high-ROI deals today. Quality over quantity always wins.",
      "Scan deals with clear price tags and model numbers for faster community approval.",
      "Verify other hunters' deals — it builds trust and earns bonus points.",
      "A 30%+ discount deal with a clear photo gets approved faster.",
      "Check multiple stores for the same product — price comparison is key.",
      "Deals with photos and UPC codes get priority approval from the community.",
      "Help a teammate today — strong teams rank higher and earn more rewards.",
    ],
    es: [
      "Enfócate en deals de alto ROI hoy. La calidad sobre la cantidad siempre gana.",
      "Escanea deals con etiquetas de precio claras para aprobación más rápida.",
      "Verifica los deals de otros cazadores — construye confianza y gana puntos extra.",
      "Un deal con 30%+ de descuento y foto clara se aprueba más rápido.",
      "Revisa múltiples tiendas — la comparación de precios es clave.",
      "Los deals con fotos y UPC reciben aprobación prioritaria de la comunidad.",
      "Ayuda a un compañero hoy — los equipos fuertes rankean más alto.",
    ],
  },
  missions: {
    en: [
      { text: "Find a deal with 35%+ discount and submit it.", type: "submit_deals", target: 1 },
      { text: "Scan 5 products and submit your best one.", type: "scan_deals", target: 5 },
      { text: "Verify 3 community deals today.", type: "verify_deals", target: 3 },
      { text: "Find a deal with ROI over 50%.", type: "scan_deals", target: 1 },
      { text: "Submit a deal with photo evidence.", type: "submit_deals", target: 1 },
      { text: "Invite one hunter to your team.", type: "invite_members", target: 1 },
      { text: "Complete any active team mission.", type: "scan_deals", target: 1 },
    ],
    es: [
      { text: "Encuentra un deal con 35%+ de descuento y envíalo.", type: "submit_deals", target: 1 },
      { text: "Escanea 5 productos y envía tu mejor deal.", type: "scan_deals", target: 5 },
      { text: "Verifica 3 deals de la comunidad hoy.", type: "verify_deals", target: 3 },
      { text: "Encuentra un deal con ROI mayor al 50%.", type: "scan_deals", target: 1 },
      { text: "Envía un deal con foto como evidencia.", type: "submit_deals", target: 1 },
      { text: "Invita a un cazador a tu equipo.", type: "invite_members", target: 1 },
      { text: "Completa cualquier misión activa del equipo.", type: "scan_deals", target: 1 },
    ],
  },
  recommendations: {
    en: [
      "Look for deals with 30%+ discount and clear product information.",
      "Always include a photo — it speeds up community approval significantly.",
      "Check Keepa price history before committing to a deal.",
      "Help verify other hunters' deals — teamwork earns everyone more.",
    ],
    es: [
      "Busca deals con 30%+ de descuento e información clara del producto.",
      "Siempre incluye una foto — acelera significativamente la aprobación de la comunidad.",
      "Revisa el historial de precios en Keepa antes de comprometerte.",
      "Ayuda a verificar los deals de otros — el trabajo en equipo beneficia a todos.",
    ],
  },
  welcome: {
    en: "Welcome to the team! 🎯 First mission: scan 5 products and submit your best deal. A photo + UPC gets you approved faster.",
    es: "¡Bienvenido al equipo! 🎯 Primera misión: escanea 5 productos y envía tu mejor deal. Una foto + UPC se aprueba más rápido.",
  },
};

// ── Recognition messages (random pick) ───────────────────────────────────────
const RECOGNITION = {
  mission_completed: {
    en: [
      "Excellent work! Mission accomplished. The team is proud of you. 🏆",
      "Outstanding! You completed your mission. Keep pushing forward.",
      "Mission done! Your contribution makes this team stronger every day.",
    ],
    es: [
      "¡Excelente trabajo! Misión cumplida. El equipo está orgulloso de ti. 🏆",
      "¡Extraordinario! Completaste tu misión. Sigue adelante.",
      "¡Misión cumplida! Tu contribución hace más fuerte a este equipo cada día.",
    ],
  },
  deal_approved: {
    en: [
      "Great find! Your deal was approved by the community. Keep hunting. 🎯",
      "Solid deal! The community validated your submission — you're building real trust.",
      "Nice work! That deal helps the whole team. The community saw its value.",
    ],
    es: [
      "¡Buen hallazgo! Tu deal fue aprobado por la comunidad. Sigue cazando. 🎯",
      "¡Deal sólido! La comunidad validó tu envío — estás construyendo confianza real.",
      "¡Buen trabajo! Ese deal ayuda a todo el equipo. La comunidad vio su valor.",
    ],
  },
  new_level: {
    en: [
      "Level up! You've earned your new rank. The team sees your progress. ⬆️",
      "Congratulations on reaching your new level! Your dedication is undeniable.",
      "New level achieved! You're becoming one of the top hunters on this team.",
    ],
    es: [
      "¡Subiste de nivel! Te ganaste tu nuevo rango. El equipo ve tu progreso. ⬆️",
      "¡Felicitaciones por alcanzar tu nuevo nivel! Tu dedicación es innegable.",
      "¡Nuevo nivel alcanzado! Te estás convirtiendo en uno de los mejores cazadores.",
    ],
  },
};

// ── FAQ (universal, 5 Q&A pairs) ─────────────────────────────────────────────
const FAQ = {
  en: [
    { q: "How do I earn points?", a: "Scan deals (+10pts), submit approved deals (+25–50pts), verify deals (+15pts), invite members (+15pts), complete missions (bonus rewards)." },
    { q: "How do I submit a deal?", a: "Go to Collaborator Dashboard → Submit Deal. Fill in the store, price, and product info. Add a photo for faster approval." },
    { q: "What is ROI?", a: "ROI = (Resale price − Deal price − Fees) ÷ Deal price × 100. Target 30%+ for a profitable flip." },
    { q: "How do I verify a deal?", a: "In the Collaborator Dashboard, go to Pending Deals. Review the submission and vote. Three upvotes = approved." },
    { q: "What if a product has no price?", a: "Submit it anyway! Include the UPC or model number. The community can complete the info — you still earn scan points." },
  ],
  es: [
    { q: "¿Cómo gano puntos?", a: "Escanea deals (+10pts), envía deals aprobados (+25–50pts), verifica deals (+15pts), invita miembros (+15pts), completa misiones (recompensas extra)." },
    { q: "¿Cómo publico una oferta?", a: "Ve al Panel de Colaborador → Enviar Deal. Completa tienda, precio e información del producto. Agrega una foto para aprobación más rápida." },
    { q: "¿Qué significa ROI?", a: "ROI = (Precio de reventa − Precio del deal − Comisiones) ÷ Precio del deal × 100. Apunta a 30%+ para una reventa rentable." },
    { q: "¿Cómo verifico una oferta?", a: "En el Panel de Colaborador, ve a Deals Pendientes. Revisa el envío y vota. Tres votos positivos = aprobado." },
    { q: "¿Qué hago si no aparece precio?", a: "¡Envíalo de todos modos! Incluye el UPC o número de modelo. La comunidad puede completar la información — igual ganas puntos de escaneo." },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────
function _content(aiRole) {
  return LEADER[aiRole] || GENERIC;
}

function getDailyTip(aiRole) {
  const c = _content(aiRole);
  const idx = dayOfYear() % c.daily_tips.en.length;
  return { en: c.daily_tips.en[idx], es: c.daily_tips.es[idx] };
}

function getMissionOfDay(aiRole) {
  const c = _content(aiRole);
  const idx = dayOfWeek() % c.missions.en.length;
  return { en: c.missions.en[idx], es: c.missions.es[idx] };
}

function getRecommendations(aiRole) {
  const c = _content(aiRole);
  return { en: c.recommendations.en, es: c.recommendations.es };
}

function getWelcomeMessage(aiRole) {
  return _content(aiRole).welcome || GENERIC.welcome;
}

function getFAQ() {
  return FAQ;
}

function getRecognitionMessage(eventType) {
  const pool = RECOGNITION[eventType] || RECOGNITION.mission_completed;
  const idx  = Math.floor(Math.random() * pool.en.length);
  return { en: pool.en[idx], es: pool.es[idx] };
}

module.exports = {
  getDailyTip,
  getMissionOfDay,
  getRecommendations,
  getWelcomeMessage,
  getFAQ,
  getRecognitionMessage,
};

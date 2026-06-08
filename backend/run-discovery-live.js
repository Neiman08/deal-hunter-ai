require('dotenv').config();

const { runAlertEngine }      = require('./src/services/alertEngine');
const { detectRecentChanges } = require('./src/services/priceChangeDetector');
const { restartBrowserPool }  = require('./src/services/browserEngine');
const { query }               = require('./src/config/database');

const POOL_RESTART_EVERY = parseInt(process.env.POOL_RESTART_CYCLES) || 5;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let cycleCount = 0;

function banner(msg, char = '═') {
  const line = char.repeat(60);
  console.log(`\n${line}\n  ${msg}\n${line}`);
}

// ─── Stats query (all stores) ─────────────────────────────────────────────────
async function getStats() {
  const r = await query(`
    SELECT
      s.slug,
      COUNT(DISTINCT p.id)                                          AS total_products,
      COUNT(d.id) FILTER (WHERE d.is_active = true)                AS active_deals,
      COUNT(d.id) FILTER (WHERE d.is_active = false)               AS inactive_deals,
      ROUND(AVG(d.discount_percent) FILTER (WHERE d.is_active=true)) AS avg_discount,
      ROUND(AVG(d.roi_percent)      FILTER (WHERE d.is_active=true)) AS avg_roi,
      MAX(p.created_at) AS last_discovery
    FROM stores s
    LEFT JOIN products p ON p.store_id = s.id
    LEFT JOIN deals d    ON d.store_id = s.id
    WHERE s.slug IN (
      'target','best-buy','lowes','home-depot','gamestop',
      'office-depot','staples','nordstrom-rack','macys',
      'kohls','tj-maxx','marshalls','burlington',
      'costco','walmart'
    )
    GROUP BY s.slug
    ORDER BY active_deals DESC
  `);
  return r.rows;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanupDeals() {
  banner('🧹 CLEANUP', '─');

  // 1) Strip URL fragments / query params for canonical dedup
  const c1 = await query(`
    UPDATE products
    SET product_url = split_part(split_part(product_url, '#', 1), '?', 1)
    WHERE product_url LIKE '%#%' OR product_url LIKE '%?%'
    RETURNING id
  `);
  if (c1.rowCount > 0) console.log(`  ✂️  Stripped query params from ${c1.rowCount} URLs`);

  // 2) Deactivate stale / fake deals
  // Only activate deals that have a real regular_price, real profit, and real discount.
  const c2 = await query(`
    UPDATE deals SET is_active=false
    WHERE last_seen_at < NOW() - INTERVAL '7 days'
       OR (
         is_error_price = false
         AND (
           regular_price IS NULL
           OR estimated_profit <= 0
           OR roi_percent <= 0
           OR discount_percent < 20
         )
       )
    RETURNING id
  `);
  console.log(`  🗑️  Deactivated ${c2.rowCount} stale/fake deals`);

  // 3) Deactivate Best Buy search-page and inflated refurbished entries
  const c3 = await query(`
    UPDATE deals d SET is_active=false
    FROM products p, stores s
    WHERE p.id=d.product_id AND s.id=d.store_id AND s.slug='best-buy'
    AND (
      p.product_url LIKE '%searchpage.jsp%'
      OR (
        (LOWER(p.name) LIKE '%refurbished%' OR LOWER(p.name) LIKE '%renewed%'
         OR LOWER(p.name) LIKE '%open box%' OR LOWER(p.name) LIKE '%geek squad certified%')
        AND d.regular_price > d.deal_price * 3
      )
    )
    RETURNING d.id
  `);
  if (c3.rowCount > 0) console.log(`  🗑️  Deactivated ${c3.rowCount} Best Buy false deals`);

  // 4) Reactivate qualifying deals for all active stores
  const c4 = await query(`
    UPDATE deals d SET is_active=true
    FROM products p, stores s
    WHERE p.id=d.product_id AND s.id=d.store_id
    AND s.slug IN (
      'target','best-buy','lowes','home-depot','gamestop',
      'office-depot','staples','nordstrom-rack','macys',
      'kohls','tj-maxx','marshalls','burlington',
      'costco','walmart'
    )
    AND p.product_url NOT LIKE '%searchpage.jsp%'
    AND d.deal_price < 10000 AND d.regular_price < 10000
    AND d.regular_price IS NOT NULL
    AND d.discount_percent >= 20
    AND d.estimated_profit > 0
    AND d.roi_percent > 0
    AND NOT (
      s.slug='best-buy' AND d.regular_price > d.deal_price * 3
      AND (LOWER(p.name) LIKE '%refurbished%' OR LOWER(p.name) LIKE '%renewed%'
           OR LOWER(p.name) LIKE '%open box%' OR LOWER(p.name) LIKE '%geek squad certified%')
    )
    RETURNING d.id
  `);
  console.log(`  ✅ Reactivated ${c4.rowCount} qualifying deals`);

  // 5) Dedup active deals by canonical URL (keep highest-score one)
  const c5 = await query(`
    WITH ranked AS (
      SELECT d.id,
        ROW_NUMBER() OVER (
          PARTITION BY split_part(split_part(p.product_url,'#',1),'?',1)
          ORDER BY d.opportunity_score DESC, d.estimated_profit DESC,
                   d.roi_percent DESC, d.last_seen_at DESC, d.id DESC
        ) rn
      FROM deals d JOIN products p ON p.id=d.product_id
      WHERE d.is_active=true
    )
    UPDATE deals d SET is_active=false
    FROM ranked r WHERE d.id=r.id AND r.rn > 1
    RETURNING d.id
  `);
  if (c5.rowCount > 0) console.log(`  🔁 Deduped ${c5.rowCount} duplicate active deals`);

  console.log('  ✅ Cleanup complete');
}

// ─── Discovery engine loader ──────────────────────────────────────────────────
function loadEngines() {
  const engines = {};
  const paths = {
    'best-buy':       './src/services/discovery/bestBuyDiscovery',
    'target':         './src/services/discovery/targetDiscovery',
    'lowes':          './src/services/discovery/lowesDiscovery',
    'home-depot':     './src/services/discovery/homeDepotDiscovery',
    'gamestop':       './src/services/discovery/gamestopDiscovery',
    'office-depot':   './src/services/discovery/officeDepotDiscovery',
    'staples':        './src/services/discovery/staplesDiscovery',
    'nordstrom-rack': './src/services/discovery/nordstromRackDiscovery',
    'macys':          './src/services/discovery/macysDiscovery',
    'kohls':          './src/services/discovery/kohlsDiscovery',
    'tj-maxx':        './src/services/discovery/tjmaxxDiscovery',
    'marshalls':      './src/services/discovery/marshallsDiscovery',
    'burlington':     './src/services/discovery/burlingtonDiscovery',
    'costco':         './src/services/discovery/costcoDiscovery',
    'walmart':        './src/services/discovery/walmartDiscovery',
  };

  for (const [slug, path] of Object.entries(paths)) {
    try {
      engines[slug] = require(path);
    } catch {
      // Not yet implemented — skip silently
    }
  }
  return engines;
}

// ─── Run one engine safely (10-minute hard timeout per store) ─────────────────
const STORE_TIMEOUT_MS = 10 * 60 * 1000;

async function runEngine(engines, slug, opts, label) {
  const eng = engines[slug];
  if (!eng) return null;

  const t0 = Date.now();
  try {
    console.log(`\n🏪 ${label || slug} Discovery...`);
    const fn = eng.runDiscovery
      || eng[`run${slug.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('')}Discovery`];
    if (!fn) { console.log(`  ⚠️  No runDiscovery export for ${slug}`); return null; }
    const s = await Promise.race([
      fn(opts),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Store timeout after ${STORE_TIMEOUT_MS / 60000}min`)), STORE_TIMEOUT_MS)),
    ]);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const blocked  = s.blocked ? ` ⛔BLOCKED(${s.blockType || '?'})` : '';
    const errInfo  = s.last_error ? ` last_error="${s.last_error}"` : '';
    console.log(`   [${slug}] pages:${s.pages_visited||0} found:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0} elapsed:${elapsed}s${blocked}${errInfo}`);
    return s;
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`  ❌ [${slug}] EXCEPTION after ${elapsed}s: ${e.message}`);
    if (e.stack) console.error(`     ${e.stack.split('\n')[1]?.trim()}`);
    return { errors: 1, last_error: e.message, saved: 0, blocked: false };
  }
}

// ─── Startup diagnostics ─────────────────────────────────────────────────────
async function logStartup() {
  const dbUrl = process.env.DATABASE_URL || '';
  let dbHost = '(DATABASE_URL not set)';
  let dbName = '(unknown)';
  try {
    const u = new URL(dbUrl);
    dbHost = u.hostname;
    dbName = u.pathname.replace(/^\//, '') || '(empty)';
  } catch {}

  const pUser = process.env.PROXY_USER || '';
  const ispUser = process.env.ISP_PROXY_USER || '';

  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║  WORKER STARTUP DIAGNOSTICS' + ' '.repeat(30) + '║');
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log(`║  NODE_ENV           : ${(process.env.NODE_ENV        || 'not set').padEnd(33)}║`);
  console.log(`║  DB host            : ${dbHost.padEnd(33)}║`);
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log('║  ── PROXY (residential) ──────────────────────────────║');
  console.log(`║  PROXY_ENABLED      : ${(process.env.PROXY_ENABLED   || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_HOST         : ${(process.env.PROXY_HOST      || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_PORT         : ${(process.env.PROXY_PORT      || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_USER         : ${(pUser ? pUser.slice(0, 33) : 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_USER (full)  : ${(pUser || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_PASS         : ${(process.env.PROXY_PASS ? '***set***' : 'not set').padEnd(33)}║`);
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log('║  ── ISP PROXY ────────────────────────────────────────║');
  console.log(`║  ISP_PROXY_ENABLED  : ${(process.env.ISP_PROXY_ENABLED  || 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_HOST     : ${(process.env.ISP_PROXY_HOST     || 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_PORT     : ${(process.env.ISP_PROXY_PORT     || 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_USER     : ${(ispUser ? ispUser.slice(0, 33) : 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_PASS     : ${(process.env.ISP_PROXY_PASS ? '***set***' : 'not set').padEnd(33)}║`);
  console.log('╠' + '═'.repeat(58) + '╣');

  // Immediate connectivity test via configured proxy
  const https = require('https');
  async function testIp(label, agentOpts) {
    return new Promise(resolve => {
      const opts = { timeout: 10000, rejectUnauthorized: false, ...agentOpts };
      const req = https.get('https://api.ipify.org?format=json', opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(`${label}: OK ip=${JSON.parse(Buffer.concat(chunks).toString()).ip}`); }
          catch { resolve(`${label}: OK (parse error)`); }
        });
      });
      req.on('error', e => resolve(`${label}: FAIL ${e.message}`));
      req.on('timeout', () => { req.destroy(); resolve(`${label}: TIMEOUT`); });
    });
  }

  // Direct
  const directResult = await testIp('DIRECT', {});
  console.log(`║  ${directResult.padEnd(55)}║`);

  // Residential proxy test
  if (process.env.PROXY_ENABLED === 'true' && pUser && process.env.PROXY_PASS) {
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
      const url = `http://${pUser}:${process.env.PROXY_PASS}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
      const agent = new Ctor(url, { rejectUnauthorized: false });
      const r = await testIp(`PROXY ${process.env.PROXY_PORT}`, { agent });
      console.log(`║  ${r.padEnd(55)}║`);
    } catch (e) {
      console.log(`║  PROXY_MAIN: AGENT_INIT_FAIL ${e.message.slice(0, 26).padEnd(27)}║`);
    }
  }

  // ISP proxy test
  if (ispUser && process.env.ISP_PROXY_PASS) {
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
      const url = `http://${ispUser}:${process.env.ISP_PROXY_PASS}@${process.env.ISP_PROXY_HOST}:${process.env.ISP_PROXY_PORT}`;
      const agent = new Ctor(url, { rejectUnauthorized: false });
      const r = await testIp(`ISP ${process.env.ISP_PROXY_PORT}`, { agent });
      console.log(`║  ${r.padEnd(55)}║`);
    } catch (e) {
      console.log(`║  ISP_PROXY: AGENT_INIT_FAIL ${e.message.slice(0, 27).padEnd(27)}║`);
    }
  }

  console.log('╠' + '═'.repeat(58) + '╣');
  try {
    const p = await query('SELECT COUNT(*) AS cnt FROM products');
    const d = await query('SELECT COUNT(*) AS cnt FROM deals WHERE is_active = true');
    console.log(`║  DB products        : ${String(p.rows[0].cnt).padEnd(33)}║`);
    console.log(`║  DB active deals    : ${String(d.rows[0].cnt).padEnd(33)}║`);
    console.log(`║  DB STATUS          : ${'CONNECTED ✓'.padEnd(33)}║`);
  } catch (e) {
    console.log(`║  DB STATUS          : ${'ERROR: '.concat(e.message).slice(0, 33).padEnd(33)}║`);
  }
  console.log('╚' + '═'.repeat(58) + '╝');
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  banner('🚀 DEAL HUNTER — LIVE DISCOVERY v3');
  await logStartup();
  const engines = loadEngines();
  console.log(`  Engines loaded: ${Object.keys(engines).join(', ')}`);
  console.log(`  Cycle interval: 30 min`);

  while (true) {
    cycleCount++;
    const cycleStart = Date.now();
    banner(`🔄 CYCLE #${cycleCount} — ${new Date().toLocaleTimeString()}`);

    const cycleStats = {};

    // ── Tier 1: Stable direct-connection stores ───────────────────────────────

    // Best Buy (link fallback, highly reliable)
    if (engines['best-buy']) {
      try {
        console.log('\n🟦 Best Buy Discovery...');
        const s = await engines['best-buy'].runBestBuyDiscovery({
          maxTotal: 500, maxPerSearch: 30, delayMs: 1200,
        });
        cycleStats['best-buy'] = s;
        console.log(`   discovered:${s.urls_discovered||s.cards_found||0} saved:${s.saved||0} errors:${s.errors||0}`);
      } catch (e) { console.error('  ❌ Best Buy error:', e.message); }
    }

    // Target (SPA — early-exit after 3 empty pages, rescans existing products)
    if (engines['target']) {
      try {
        console.log('\n🎯 Target Discovery...');
        const s = await engines['target'].runTargetDiscovery({
          maxTotal: 500, maxPerPage: 50, delayMs: 1200,
        });
        cycleStats['target'] = s;
        console.log(`   discovered:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0}`);
      } catch (e) { console.error('  ❌ Target error:', e.message); }
    }

    // Tier 1 direct stores
    cycleStats['lowes']        = await runEngine(engines, 'lowes',        { maxTotal: 150, maxPerPage: 30, delayMs: 2500 }, "Lowe's");
    cycleStats['home-depot']   = await runEngine(engines, 'home-depot',   { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Home Depot');
    cycleStats['gamestop']     = await runEngine(engines, 'gamestop',     { maxTotal: 200, maxPerPage: 30, delayMs: 2000 }, 'GameStop');
    cycleStats['office-depot'] = await runEngine(engines, 'office-depot', { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Office Depot');
    cycleStats['staples']      = await runEngine(engines, 'staples',      { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Staples');

    // ── Tier 2: Residential proxy stores ─────────────────────────────────────
    // Max 1-2 Akamai attempts (controlled by proxyManager)

    cycleStats['nordstrom-rack'] = await runEngine(engines, 'nordstrom-rack', { maxTotal: 120, maxPerPage: 25, delayMs: 2500 }, 'Nordstrom Rack');
    // Macy's uses SPA interception (no proxy) — maxPerPage not applicable
    cycleStats['macys']          = await runEngine(engines, 'macys',          { maxTotal: 120, delayMs: 800 }, "Macy's");

    // ── Tier 3: Akamai-protected (limited attempts) ───────────────────────────
    // proxyManager.shouldSkipStore() gates these if too many failures occurred
    // maxConsecutiveEmpty=2 inside each engine gives up after 2 blocked pages

    cycleStats['kohls']      = await runEngine(engines, 'kohls',      { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, "Kohl's");
    cycleStats['tj-maxx']    = await runEngine(engines, 'tj-maxx',    { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, 'TJ Maxx');
    cycleStats['marshalls']  = await runEngine(engines, 'marshalls',  { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, 'Marshalls');
    cycleStats['burlington'] = await runEngine(engines, 'burlington', { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, 'Burlington');

    // Optional: Costco (direct, lower priority)
    cycleStats['costco']   = await runEngine(engines, 'costco',   { maxTotal: 100, maxPerPage: 25, delayMs: 2500 }, 'Costco');

    // Walmart — residential proxy, Akamai may block
    cycleStats['walmart']  = await runEngine(engines, 'walmart',  { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Walmart');

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await cleanupDeals().catch(e => console.error('Cleanup error:', e.message));

    // ── Price change detection ────────────────────────────────────────────────
    try {
      const changeStats = await detectRecentChanges();
      if (changeStats.total > 0) {
        console.log(`\n📉 Price changes: ${changeStats.markdowns} markdowns, ${changeStats.pennies} penny items`);
      }
    } catch (e) { console.error('Price detection error:', e.message); }

    // ── Alert engine ──────────────────────────────────────────────────────────
    try {
      const alertStats = await runAlertEngine();
      if (alertStats.watchlist?.triggered > 0 || alertStats.configured?.triggered > 0) {
        console.log(`\n🔔 Alerts fired: watchlist=${alertStats.watchlist?.triggered} configured=${alertStats.configured?.triggered}`);
      }
    } catch (e) { console.error('Alert engine error:', e.message); }

    // ── DB Stats summary ──────────────────────────────────────────────────────
    try {
      const stats = await getStats();
      console.log('\n📊 DATABASE SUMMARY:');
      console.log('  ' + ['Store','Products','Active Deals','Avg Discount','Avg ROI'].map(h=>h.padEnd(16)).join(''));
      for (const s of stats) {
        console.log('  ' + [
          s.slug, s.total_products, s.active_deals,
          s.avg_discount ? s.avg_discount + '%' : '—',
          s.avg_roi ? s.avg_roi + '%' : '—',
        ].map(v => String(v).padEnd(16)).join(''));
      }
    } catch (e) { console.error('Stats error:', e.message); }

    // ── Cycle summary ─────────────────────────────────────────────────────────
    const blockedStores = Object.entries(cycleStats).filter(([,s]) => s?.blocked).map(([k]) => k);
    if (blockedStores.length) {
      console.log(`\n⛔ Blocked stores this cycle: ${blockedStores.join(', ')}`);
    }

    const savedThisCycle = Object.values(cycleStats).reduce((sum, s) => sum + (s?.saved || 0), 0);
    try {
      const p = await query('SELECT COUNT(*) AS cnt FROM products');
      const d = await query('SELECT COUNT(*) AS cnt FROM deals WHERE is_active = true');
      console.log(`\n📈 DB after cycle #${cycleCount}: products=${p.rows[0].cnt} active_deals=${d.rows[0].cnt} saved_this_cycle=${savedThisCycle}`);
    } catch {}

    const elapsed = Math.round((Date.now() - cycleStart) / 1000);
    console.log(`\n⏱️  Cycle #${cycleCount} completed in ${elapsed}s. Next cycle in 30 min...`);

    // Restart browser pool every N cycles (reclaims Chromium memory)
    if (cycleCount % POOL_RESTART_EVERY === 0) {
      console.log('\n♻️  Restarting browser pool (memory maintenance)...');
      await restartBrowserPool().catch(e => console.error('Pool restart error:', e.message));
    }

    await sleep(30 * 60 * 1000);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

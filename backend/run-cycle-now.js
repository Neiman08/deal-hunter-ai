require('dotenv').config();

const NEXT_CYCLE = Math.floor(Date.now() / (30 * 60 * 1000)) + 1;
const _realNow   = Date.now.bind(Date);
Date.now = () => NEXT_CYCLE * 30 * 60 * 1000 + 60000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  const cycleCheck = Math.floor(Date.now() / (30 * 60 * 1000));
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FORCED CYCLE #${NEXT_CYCLE} (Date.now patched, cycleCheck=${cycleCheck})`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── Best Buy ──────────────────────────────────────────────────────────────
  console.log('🟦 Best Buy Discovery...');
  try {
    const { runBestBuyDiscovery } = require('./src/services/discovery/bestBuyDiscovery');
    const s = await runBestBuyDiscovery({ maxTotal: 100, maxPerSearch: 20, delayMs: 1200 });
    console.log(`   ✅ cards_found:${s.cards_found||s.urls_discovered||0} saved:${s.saved||0} errors:${s.errors||0}`);
  } catch (e) { console.error(`   ❌ BB error: ${e.message}`); }

  // ── Target ────────────────────────────────────────────────────────────────
  console.log('\n🎯 Target Discovery...');
  try {
    const { runTargetDiscovery } = require('./src/services/discovery/targetDiscovery');
    const s = await runTargetDiscovery({ maxTotal: 50, maxPerPage: 20, delayMs: 1500 });
    console.log(`   ✅ discovered:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0}`);
  } catch (e) { console.error(`   ❌ Target error: ${e.message}`); }

  // ── GameStop ──────────────────────────────────────────────────────────────
  console.log('\n🎮 GameStop Discovery...');
  try {
    const { runGameStopDiscovery } = require('./src/services/discovery/gamestopDiscovery');
    const s = await runGameStopDiscovery({ maxTotal: 60, maxPerPage: 25, delayMs: 1800 });
    console.log(`   ✅ found:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0}`);
  } catch (e) { console.error(`   ❌ GameStop error: ${e.message}`); }

  // ── Staples ───────────────────────────────────────────────────────────────
  console.log('\n📎 Staples Discovery...');
  try {
    const { runStaplesDiscovery } = require('./src/services/discovery/staplesDiscovery');
    const s = await runStaplesDiscovery({ maxTotal: 80, maxPerPage: 25, delayMs: 1800 });
    console.log(`   ✅ found:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0}`);
  } catch (e) { console.error(`   ❌ Staples error: ${e.message}`); }

  // ── Lowe's ────────────────────────────────────────────────────────────────
  console.log("\n🏪 Lowe's Discovery...");
  try {
    const { runLowesDiscovery } = require('./src/services/discovery/lowesDiscovery');
    const s = await runLowesDiscovery({ maxTotal: 80, delayMs: 2000 });
    console.log(`   ✅ found:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} active_deals:${s.active_deals||0}`);
  } catch (e) { console.error(`   ❌ Lowe's error: ${e.message}`); }

  // ── Office Depot ──────────────────────────────────────────────────────────
  console.log('\n📦 Office Depot Discovery...');
  try {
    const { runOfficeDepotDiscovery } = require('./src/services/discovery/officeDepotDiscovery');
    const s = await runOfficeDepotDiscovery({ maxTotal: 60 });
    console.log(`   ✅ saved:${s.saved||0} no_price:${s.no_price||0} errors:${s.errors||0}`);
  } catch (e) { console.error(`   ❌ OD error: ${e.message}`); }

  // ── Final DB report ───────────────────────────────────────────────────────
  const { query } = require('./src/config/database');
  const r = await query(`
    SELECT s.slug,
      COUNT(*) total,
      COUNT(*) FILTER (WHERE d.is_active=true) active,
      COUNT(*) FILTER (
        WHERE d.is_active=true
          AND d.regular_price IS NOT NULL AND d.regular_price > d.deal_price
          AND d.estimated_profit > 0 AND d.roi_percent > 5
          AND d.discount_percent >= 20
      ) real_opportunities
    FROM deals d JOIN stores s ON s.id=d.store_id
    GROUP BY s.slug ORDER BY active DESC
  `);
  const pad = (v, n=16) => String(v).padEnd(n);
  console.log('\n' + '═'.repeat(60));
  console.log('  📊 FINAL REPORT — cycle #' + NEXT_CYCLE);
  console.log('═'.repeat(60));
  console.log('  ' + [pad('store'), pad('total'), pad('active'), pad('real_opps')].join(''));
  for (const row of r.rows) {
    console.log('  ' + [pad(row.slug), pad(row.total), pad(row.active), pad(row.real_opportunities)].join(''));
  }
  console.log('\n✅ Done.\n');
  process.exit(0);
}

run().catch(e => { console.error('Fatal:', e.stack); process.exit(1); });

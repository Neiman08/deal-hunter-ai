/**
 * Targeted discovery run — GameStop, Office Depot, Staples only.
 * Used to verify the full pipeline (discover → scrape → save) works.
 */
require('dotenv').config();
const { query } = require('./src/config/database');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const STORES = [
  {
    slug: 'gamestop',
    label: 'GameStop',
    path: './src/services/discovery/gamestopDiscovery',
    opts: { maxTotal: 30, maxPerPage: 30, delayMs: 1500 },
    pages: 3,
  },
  {
    slug: 'office-depot',
    label: 'Office Depot',
    path: './src/services/discovery/officeDepotDiscovery',
    opts: { maxTotal: 30, maxPerPage: 30, delayMs: 1500 },
    pages: 3,
  },
  {
    slug: 'staples',
    label: 'Staples',
    path: './src/services/discovery/staplesDiscovery',
    opts: { maxTotal: 30, maxPerPage: 30, delayMs: 2000 },
    pages: 2,
  },
];

async function getProductCount(slug) {
  const r = await query(
    `SELECT COUNT(DISTINCT p.id) as cnt FROM products p
     JOIN stores s ON p.store_id = s.id WHERE s.slug = $1`,
    [slug]
  );
  return parseInt(r.rows[0].cnt);
}

async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log('  TARGETED DISCOVERY — GameStop / Office Depot / Staples');
  console.log('  Max 3 pages per store — full pipeline test');
  console.log('═'.repeat(65) + '\n');

  const results = [];

  for (const store of STORES) {
    const before = await getProductCount(store.slug);
    console.log(`\n▶ ${store.label} (${before} products before)...`);

    const t0 = Date.now();
    try {
      const eng = require(store.path);
      const pages = eng.DISCOVERY_PAGES
        ? eng.DISCOVERY_PAGES.slice(0, store.pages)
        : undefined;
      const opts = pages ? { ...store.opts, pages } : store.opts;
      const stats = await eng.runDiscovery(opts);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const after = await getProductCount(store.slug);

      results.push({
        label: store.label,
        slug: store.slug,
        pages_visited: stats.pages_visited,
        urls_found: stats.urls_discovered,
        urls_new: stats.urls_new,
        saved: stats.saved || 0,
        errors: stats.errors || 0,
        before,
        after,
        new_products: after - before,
        elapsed,
        blocked: stats.blocked,
        blockType: stats.blockType,
      });

      const icon = (after - before) > 0 ? '✅' : stats.blocked ? '⛔' : '⚠️ ';
      console.log(`  ${icon} pages=${stats.pages_visited} found=${stats.urls_discovered} saved=${stats.saved || 0} db_new=${after - before} (${elapsed}s)`);
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const after = await getProductCount(store.slug);
      results.push({ label: store.label, slug: store.slug, error: err.message, before, after, new_products: after - before, elapsed });
      console.log(`  ❌ ERROR: ${err.message.slice(0, 80)} (${elapsed}s)`);
    }

    await sleep(2000);
  }

  // Summary
  console.log('\n\n' + '═'.repeat(65));
  console.log('  RESULTS');
  console.log('═'.repeat(65));
  console.log(
    '  ' +
    'Store'.padEnd(16) +
    'Pages'.padEnd(7) +
    'Found'.padEnd(7) +
    'Saved'.padEnd(7) +
    'DB New'.padEnd(8) +
    'Time'
  );
  console.log('  ' + '─'.repeat(55));

  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label.padEnd(16)} ERROR: ${r.error.slice(0, 40)}`);
      continue;
    }
    const status = r.new_products > 0 ? '✅' : r.blocked ? '⛔' : '⚠️ ';
    console.log(
      `  ${status} ` +
      r.label.padEnd(14) +
      String(r.pages_visited || 0).padEnd(7) +
      String(r.urls_found || 0).padEnd(7) +
      String(r.saved || 0).padEnd(7) +
      String(r.new_products).padEnd(8) +
      r.elapsed + 's'
    );
  }

  // DB state
  console.log('\n  DB state after run:');
  const db = await query(`
    SELECT s.slug, COUNT(DISTINCT p.id) as products,
      COUNT(d.id) FILTER (WHERE d.is_active) as active_deals
    FROM stores s
    LEFT JOIN products p ON p.store_id = s.id
    LEFT JOIN deals d ON d.product_id = p.id
    WHERE s.slug IN ('gamestop','office-depot','staples')
    GROUP BY s.slug ORDER BY s.slug
  `);
  db.rows.forEach(r =>
    console.log(`  ${r.slug.padEnd(16)} products: ${r.products}  active_deals: ${r.active_deals}`)
  );

  console.log('\n' + '═'.repeat(65) + '\n');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

require('dotenv').config();
const { query } = require('./src/config/database');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const NEW_STORES = [
  { slug: 'home-depot',     label: 'Home Depot',     path: './src/services/discovery/homeDepotDiscovery',     opts: { maxTotal: 30, maxPerPage: 15, delayMs: 1500 } },
  { slug: 'gamestop',       label: 'GameStop',        path: './src/services/discovery/gamestopDiscovery',      opts: { maxTotal: 30, maxPerPage: 15, delayMs: 1500 } },
  { slug: 'office-depot',   label: 'Office Depot',    path: './src/services/discovery/officeDepotDiscovery',   opts: { maxTotal: 20, maxPerPage: 10, delayMs: 1500 } },
  { slug: 'staples',        label: 'Staples',         path: './src/services/discovery/staplesDiscovery',       opts: { maxTotal: 20, maxPerPage: 10, delayMs: 1500 } },
  { slug: 'nordstrom-rack', label: 'Nordstrom Rack',  path: './src/services/discovery/nordstromRackDiscovery', opts: { maxTotal: 20, maxPerPage: 10, delayMs: 2000 } },
  { slug: 'macys',          label: "Macy's",          path: './src/services/discovery/macysDiscovery',         opts: { maxTotal: 20, maxPerPage: 10, delayMs: 2500 } },
  { slug: 'kohls',          label: "Kohl's",          path: './src/services/discovery/kohlsDiscovery',         opts: { maxTotal: 20, maxPerPage: 10, delayMs: 2500 } },
  { slug: 'tj-maxx',        label: 'TJ Maxx',         path: './src/services/discovery/tjmaxxDiscovery',        opts: { maxTotal: 20, maxPerPage: 10, delayMs: 2500 } },
  { slug: 'marshalls',      label: 'Marshalls',       path: './src/services/discovery/marshallsDiscovery',     opts: { maxTotal: 20, maxPerPage: 10, delayMs: 2500 } },
  { slug: 'burlington',     label: 'Burlington',      path: './src/services/discovery/burlingtonDiscovery',    opts: { maxTotal: 15, maxPerPage: 8,  delayMs: 2500 } },
];

async function runStore(store) {
  const t0 = Date.now();
  try {
    const eng = require(store.path);
    // Use only first 3 pages to keep test fast
    const pages = eng.DISCOVERY_PAGES ? eng.DISCOVERY_PAGES.slice(0, 3) : undefined;
    const opts = pages ? { ...store.opts, pages } : store.opts;
    const stats = await eng.runDiscovery(opts);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    return { ...stats, elapsed, label: store.label };
  } catch (err) {
    return { label: store.label, error: err.message, elapsed: ((Date.now() - t0) / 1000).toFixed(1) };
  }
}

async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log('  NEW STORES DISCOVERY TEST');
  console.log('  Only first 3 pages per store — fast validation run');
  console.log('═'.repeat(65) + '\n');

  const results = [];

  for (const store of NEW_STORES) {
    console.log(`\n▶ ${store.label}...`);
    const r = await runStore(store);
    results.push(r);
    // Brief pause between stores
    await sleep(2000);
  }

  // Summary table
  console.log('\n\n' + '═'.repeat(65));
  console.log('  RESULTS SUMMARY');
  console.log('═'.repeat(65));
  console.log(
    '  ' +
    'Store'.padEnd(18) +
    'Pages'.padEnd(8) +
    'Found'.padEnd(8) +
    'New'.padEnd(7) +
    'Saved'.padEnd(8) +
    'Errors'.padEnd(8) +
    'Blocked'.padEnd(10) +
    'Time'
  );
  console.log('  ' + '─'.repeat(63));

  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label.padEnd(18)} ERROR: ${r.error.slice(0, 40)}`);
      continue;
    }
    const blocked = r.blocked ? `⛔ ${r.blockType || 'yes'}` : '—';
    console.log(
      '  ' +
      r.label.padEnd(18) +
      String(r.pages_visited   || 0).padEnd(8) +
      String(r.urls_discovered || 0).padEnd(8) +
      String(r.urls_new        || 0).padEnd(7) +
      String(r.saved           || 0).padEnd(8) +
      String(r.errors          || 0).padEnd(8) +
      blocked.padEnd(10) +
      `${r.elapsed}s`
    );
  }

  // DB state for new stores
  console.log('\n\n' + '═'.repeat(65));
  console.log('  DATABASE STATE — NEW STORES');
  console.log('═'.repeat(65));
  try {
    const db = await query(`
      SELECT s.slug, s.name,
        COUNT(DISTINCT p.id)                                          AS products,
        COUNT(d.id) FILTER (WHERE d.is_active = true)                AS active_deals,
        ROUND(AVG(d.discount_percent) FILTER (WHERE d.is_active=true)) AS avg_discount,
        ROUND(AVG(d.estimated_profit) FILTER (WHERE d.is_active=true)) AS avg_profit
      FROM stores s
      LEFT JOIN products p ON p.store_id = s.id
      LEFT JOIN deals d    ON d.store_id = s.id
      WHERE s.slug IN ('home-depot','gamestop','office-depot','staples',
                       'nordstrom-rack','macys','kohls','tj-maxx','marshalls','burlington')
      GROUP BY s.slug, s.name
      ORDER BY active_deals DESC, products DESC
    `);
    console.log(
      '\n  ' +
      'Store'.padEnd(18) +
      'Products'.padEnd(12) +
      'Active Deals'.padEnd(15) +
      'Avg Disc%'.padEnd(12) +
      'Avg Profit'
    );
    console.log('  ' + '─'.repeat(63));
    for (const r of db.rows) {
      console.log(
        '  ' +
        r.slug.padEnd(18) +
        String(r.products).padEnd(12) +
        String(r.active_deals).padEnd(15) +
        (r.avg_discount ? r.avg_discount + '%' : '—').padEnd(12) +
        (r.avg_profit   ? '$' + r.avg_profit   : '—')
      );
    }
  } catch (e) {
    console.error('DB query error:', e.message);
  }

  console.log('\n' + '═'.repeat(65) + '\n');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

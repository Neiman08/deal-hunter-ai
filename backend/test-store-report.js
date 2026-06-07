require('dotenv').config();
const { chromium } = require('playwright');
const { newBestBuyContext, newIspContext } = require('./src/services/browserEngine');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// One representative test URL per store
const STORES = [
  { slug: 'macys',          label: "Macy's",          url: 'https://www.macys.com/shop/sale/women?sortby=price_low_to_high',     ctx: 'isp',    linkFilter: h => h.includes('/p/') || /\/\d{7,}/.test(h) },
  { slug: 'kohls',          label: "Kohl's",           url: 'https://www.kohls.com/catalog/sale-clearance.jsp?CN=Promotions:Clearance&PPP=60', ctx: 'isp', linkFilter: h => h.includes('/p/') || h.includes('/product/') },
  { slug: 'tj-maxx',        label: 'TJ Maxx',          url: 'https://www.tjmaxx.tjx.com/store/jump/topic/clearance-home/cat3340002', ctx: 'isp', linkFilter: h => h.includes('/product/') && /\/\d{5,}$/.test(h.split('?')[0]) },
  { slug: 'marshalls',      label: 'Marshalls',        url: 'https://www.marshalls.com/us/store/jump/topic/clearance-home/cat3340002', ctx: 'isp', linkFilter: h => h.includes('/product/') && /\/\d{5,}$/.test(h.split('?')[0]) },
  { slug: 'burlington',     label: 'Burlington',       url: 'https://www.burlington.com/category/clearance?sortby=price_low_to_high', ctx: 'isp', linkFilter: h => h.includes('/product/') },
  { slug: 'lowes',          label: "Lowe's",           url: 'https://www.lowes.com/search?searchTerm=clearance+tools',             ctx: 'isp',    linkFilter: h => h.includes('/pd/') || h.includes('/product/') },
  { slug: 'nordstrom-rack', label: 'Nordstrom Rack',   url: 'https://www.nordstromrack.com/sale/women?sortBy=PriceAscending',      ctx: 'isp',    linkFilter: h => h.includes('/s/') || /\/\d{7,}$/.test(h) },
  { slug: 'home-depot',     label: 'Home Depot',       url: 'https://www.homedepot.com/b/Clearance/N-5yc1v',                       ctx: 'direct', linkFilter: h => h.includes('/p/') && /\/\d{6,}/.test(h) },
  { slug: 'gamestop',       label: 'GameStop',         url: 'https://www.gamestop.com/deals',                                      ctx: 'direct', linkFilter: h => h.includes('/products/') || /\/\d{7,}\.html/.test(h) },
  { slug: 'office-depot',   label: 'Office Depot',     url: 'https://www.officedepot.com/l/deals',                                 ctx: 'direct', linkFilter: h => h.includes('/a/products/') },
  { slug: 'staples',        label: 'Staples',          url: 'https://www.staples.com/deals',                                       ctx: 'direct', linkFilter: h => h.match(/\/cat_[A-Za-z]+\d+\/\d{5,}/) },
  { slug: 'costco',         label: 'Costco',           url: 'https://www.costco.com/clearance.html',                               ctx: 'direct', linkFilter: h => h.includes('/p/') },
];

async function testStore(store) {
  const t0 = Date.now();
  let ctx;
  try {
    ctx = store.ctx === 'isp' ? await newIspContext() : await newBestBuyContext();
    const page = await ctx.newPage();
    const response = await page.goto(store.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const elapsed  = ((Date.now() - t0) / 1000).toFixed(1);
    const status   = response?.status();
    const title    = await page.title().catch(() => '—');
    const html     = await page.content().catch(() => '');
    const blocked  = status === 403 || html.includes('Access Denied') || html.includes('Robot or human') ||
                     html.includes('security check') || title.toLowerCase().includes('access denied') ||
                     html.includes('cf-browser-verification') || html.includes('JACPKMALPHTCSJDTCR');

    let productLinks = 0;
    if (!blocked) {
      const links = await page.$$eval('a[href]', els => els.map(a => a.getAttribute('href')).filter(Boolean)).catch(() => []);
      productLinks = links.filter(h => {
        try { return store.linkFilter(h); } catch { return false; }
      }).length;
    }

    const blockType = status === 403 ? 'HTTP 403' :
      html.includes('JACPKMALPHTCSJDTCR') ? 'Akamai' :
      html.includes('Robot or human') ? 'Bot check' :
      html.includes('Access Denied') ? 'Access Denied' : '—';

    await page.close().catch(() => {});
    return { ...store, status, title: title.slice(0, 50), blocked, blockType, productLinks, elapsed };
  } catch (err) {
    return { ...store, status: 'ERR', title: '—', blocked: true, blockType: err.message.slice(0, 40), productLinks: 0, elapsed: ((Date.now() - t0)/1000).toFixed(1) };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('  COMPREHENSIVE STORE REPORT — ISP Proxy Test');
  console.log('  Testing 1 page per store. ISP=brd.superproxy.io:33335');
  console.log('═'.repeat(80) + '\n');

  const results = [];
  for (const store of STORES) {
    process.stdout.write(`▶ Testing ${store.label.padEnd(16)}...`);
    const r = await testStore(store);
    results.push(r);
    const icon = r.blocked ? '⛔' : (r.productLinks > 0 ? '✅' : '⚠️ ');
    console.log(` ${icon}  status=${r.status} | links=${r.productLinks} | ${r.elapsed}s | ${r.blocked ? r.blockType : r.title}`);
    await sleep(1500);
  }

  console.log('\n\n' + '═'.repeat(80));
  console.log('  SUMMARY');
  console.log('═'.repeat(80));
  console.log(
    '  ' +
    'Store'.padEnd(18) +
    'Proxy'.padEnd(8) +
    'Status'.padEnd(8) +
    'Links'.padEnd(8) +
    'Blocked'.padEnd(14) +
    'Time'.padEnd(8) +
    'Why'
  );
  console.log('  ' + '─'.repeat(78));

  for (const r of results) {
    const proxy  = r.ctx === 'isp' ? 'ISP' : 'Direct';
    const status = r.blocked ? '⛔ BLOCK' : (r.productLinks > 0 ? '✅ OK' : '⚠️  Empty');
    const why    = r.blocked ? r.blockType : (r.productLinks > 0 ? `${r.productLinks} product links` : 'page loaded, 0 matches');
    console.log(
      '  ' +
      r.label.padEnd(18) +
      proxy.padEnd(8) +
      r.status.toString().padEnd(8) +
      String(r.productLinks).padEnd(8) +
      (r.blocked ? r.blockType : '—').padEnd(14) +
      r.elapsed.padEnd(8) +
      why
    );
  }

  const working  = results.filter(r => !r.blocked && r.productLinks > 0);
  const empty    = results.filter(r => !r.blocked && r.productLinks === 0);
  const blocked  = results.filter(r => r.blocked);
  console.log(`\n  ✅ Working (found links): ${working.map(r=>r.label).join(', ') || 'none'}`);
  console.log(`  ⚠️  Loaded but 0 links:   ${empty.map(r=>r.label).join(', ') || 'none'}`);
  console.log(`  ⛔ Blocked:              ${blocked.map(r=>r.label).join(', ') || 'none'}`);
  console.log('\n' + '═'.repeat(80) + '\n');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

/**
 * Check all active Macy's deals via xapi from within a browser session.
 * xapi calls from inside macys.com browser session are NOT blocked by Akamai.
 * Deactivates any deal where xapi returns 404 (product actually gone).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dealsRes = await query(`
    SELECT d.id AS deal_id, p.id AS product_id, p.name, p.product_url, p.sku,
      REGEXP_REPLACE(p.product_url, '.*/ID/', '') AS macys_id
    FROM deals d
    JOIN products p ON d.product_id = p.id
    JOIN stores s ON d.store_id = s.id
    WHERE s.slug = 'macys' AND d.is_active = true
      AND p.product_url IS NOT NULL
    ORDER BY d.opportunity_score DESC NULLS LAST
  `);
  const deals = dealsRes.rows;
  console.log(`Checking ${deals.length} active Macy's deals via xapi...\n`);

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
    timezoneId: 'America/Chicago',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const page = await ctx.newPage();

  console.log('Warming session on macys.com...');
  await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await page.title().catch(() => '');
  console.log(`Homepage: "${homeTitle}"`);

  if (/access denied/i.test(homeTitle)) {
    console.log('Session blocked on homepage — cannot run xapi checks');
    await browser.close();
    process.exit(1);
  }

  await sleep(2000);

  const results = [];
  const BATCH = 5;

  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    const xapi = await page.evaluate(async (id) => {
      const resp = await fetch(
        `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`,
        { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } }
      );
      if (!resp.ok) return { status: resp.status, exists: false };
      const data = await resp.json().catch(() => null);
      const p = data?.product?.[0];
      return { status: resp.status, exists: !!p, name: p?.detail?.name?.slice(0, 45) };
    }, d.macys_id).catch(() => ({ status: 0, exists: false }));

    const icon = xapi.exists ? '✅' : xapi.status === 404 ? '❌' : '⚠️';
    console.log(`${icon} [${i+1}/${deals.length}] id:${d.macys_id.padEnd(9)} | HTTP:${xapi.status} | ${xapi.exists ? `EXISTS "${xapi.name}"` : `MISSING`}`);

    results.push({ ...d, xapi_exists: xapi.exists, xapi_status: xapi.status, xapi_name: xapi.name });
    await sleep(200);

    // Brief pause every 5 to avoid rate limiting
    if ((i + 1) % BATCH === 0 && i < deals.length - 1) {
      console.log(`  (pause after ${i+1} checks...)`);
      await sleep(1500);
    }
  }

  await browser.close();

  const dead = results.filter(r => r.xapi_status === 404 || (r.xapi_status === 200 && !r.xapi_exists));
  const rate_limited = results.filter(r => r.xapi_status === 403 || r.xapi_status === 0);
  const alive = results.filter(r => r.xapi_exists);

  console.log(`\n════ XAPI RESULTS ════`);
  console.log(`EXISTS: ${alive.length}/${deals.length}`);
  console.log(`MISSING (404): ${dead.length}`);
  console.log(`Rate-limited (403/error): ${rate_limited.length}`);

  if (dead.length > 0) {
    console.log('\n--- Deactivating confirmed-dead deals ---');
    for (const r of dead) {
      await query('UPDATE deals SET is_active=false WHERE id=$1', [r.deal_id]);
      console.log(`  Deactivated deal:${r.deal_id.slice(0,8)} product:${r.macys_id} "${r.name?.slice(0,40)}"`);
    }
    console.log(`Deactivated ${dead.length} deals.`);
  } else {
    console.log('\nNo confirmed-dead products found — all xapi-checkable deals are live.');
  }

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

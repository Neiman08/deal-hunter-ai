/**
 * Macy's URL test via BrightData ISP proxy (port 33335).
 * ISP proxies have static datacenter IPs with ISP AS numbers —
 * better bot-detection bypass than residential for browser automation.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dealsRes = await query(`
    SELECT d.id AS deal_id, p.name, p.product_url,
      REGEXP_REPLACE(p.product_url, '.*/ID/', '') AS macys_id
    FROM deals d
    JOIN products p ON d.product_id = p.id
    JOIN stores s ON d.store_id = s.id
    WHERE s.slug = 'macys' AND d.is_active = true
      AND p.product_url IS NOT NULL
    ORDER BY d.opportunity_score DESC NULLS LAST
    LIMIT 5
  `);
  const deals = dealsRes.rows;

  const ispHost = process.env.ISP_PROXY_HOST;
  const ispPort = parseInt(process.env.ISP_PROXY_PORT || '33335');
  const ispUser = process.env.ISP_PROXY_USER;
  const ispPass = process.env.ISP_PROXY_PASS;

  if (!ispUser || !ispPass) {
    console.log('ERROR: ISP_PROXY_USER or ISP_PROXY_PASS not set in .env');
    process.exit(1);
  }
  console.log(`Using ISP proxy: ${ispHost}:${ispPort} (credentials from .env)`);

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({
    headless: false,
    proxy: { server: `http://${ispHost}:${ispPort}`, username: ispUser, password: ispPass },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
    timezoneId: 'America/Chicago',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const page = await ctx.newPage();

  console.log('Loading Macy\'s homepage via ISP proxy...');
  await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await page.title().catch(() => '');
  console.log(`Homepage: "${homeTitle}"`);

  if (/access denied/i.test(homeTitle)) {
    console.log('ISP proxy also blocked on homepage. Checking if xapi works from within browser...');
    // Try xapi from blocked session to see HTTP status
    for (const d of deals.slice(0,2)) {
      const xr = await page.evaluate(async (id) => {
        const r = await fetch(`/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`,
          { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
        return { status: r.status, ok: r.ok };
      }, d.macys_id).catch(e => ({ status: 0, error: e.message }));
      console.log(`  xapi id:${d.macys_id} → status:${xr.status}`);
    }
    await browser.close();
    return;
  }

  await sleep(3000);
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);

  const results = [];

  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    console.log(`\n[${i+1}/5] id:${d.macys_id} | "${d.name?.slice(0,45)}"`);

    // xapi from browser session
    const xapi = await page.evaluate(async (id) => {
      const r = await fetch(`/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`,
        { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
      if (!r.ok) return { status: r.status, exists: false };
      const j = await r.json().catch(() => null);
      const p = j?.product?.[0];
      return { status: r.status, exists: !!p, name: p?.detail?.name?.slice(0,40) };
    }, d.macys_id).catch(() => ({ status: 0, exists: false }));
    console.log(`  xapi: ${xapi.exists ? `EXISTS "${xapi.name}"` : `HTTP ${xapi.status}`}`);

    await page.goto(d.product_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);

    const title = await page.title().catch(() => '');
    const bodyText = await page.$eval('body', el => el.innerText?.slice(0,400)).catch(() => '');
    const is404 = /page not found|we couldn.t find|oops/i.test(title + bodyText);
    const isBlocked = /access denied/i.test(title);
    const pageResult = is404 ? 'PAGE_NOT_FOUND' : isBlocked ? 'AKAMAI_BLOCK' : 'PAGE_OK';
    console.log(`  page: ${pageResult} | title: "${title.slice(0,70)}"`);

    results.push({ macys_id: d.macys_id, name: d.name?.slice(0,40), xapi_exists: xapi.exists, page: pageResult, title: title.slice(0,70), url: d.product_url });

    if (i < deals.length - 1) {
      await sleep(5000);
      await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(4000);
    }
  }

  await browser.close();

  console.log('\n\n════ MACY\'S ISP PROXY URL TEST ════');
  for (const r of results) {
    const icon = r.page === 'PAGE_OK' ? '✅' : r.page === 'AKAMAI_BLOCK' ? '⚠️' : '❌';
    const xIcon = r.xapi_exists ? '✅' : '❌';
    console.log(`${icon} id:${r.macys_id.padEnd(9)} | xapi:${xIcon} | ${r.page.padEnd(14)} | "${r.title.slice(0,60)}"`);
  }
  const ok = results.filter(r => r.page === 'PAGE_OK').length;
  const nf = results.filter(r => r.page === 'PAGE_NOT_FOUND').length;
  const xOk = results.filter(r => r.xapi_exists).length;
  console.log(`\nxapi EXISTS: ${xOk}/5 | PAGE_OK: ${ok}/5 | PAGE_NOT_FOUND: ${nf}/5`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

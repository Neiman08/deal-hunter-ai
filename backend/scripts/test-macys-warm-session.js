/**
 * Macy's URL test using a SINGLE warmed session with long waits.
 * The first test showed PAGE_OK when using an existing warm session.
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
      AND REGEXP_REPLACE(p.product_url, '.*/ID/', '') ~ '^[0-9]+$'
    ORDER BY d.opportunity_score DESC NULLS LAST
    LIMIT 5
  `);
  const deals = dealsRes.rows;

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
    timezoneId: 'America/Chicago',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const page = await ctx.newPage();

  // Warm up session — navigate to homepage and wait properly
  console.log('Loading Macy\'s homepage to warm session...');
  await page.goto('https://www.macys.com/', { waitUntil: 'load', timeout: 45000 });
  await sleep(6000); // wait for all JS to init

  const homeTitle = await page.title();
  console.log(`Homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) { await browser.close(); process.exit(1); }

  // Browse the homepage briefly like a human
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);

  const results = [];

  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    console.log(`\n[${i+1}/5] id:${d.macys_id} | "${d.name?.slice(0,45)}"`);

    // xapi check from warm session
    const xapi = await page.evaluate(async (id) => {
      const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
      const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
      if (!resp.ok) return { status: resp.status, exists: false };
      const data = await resp.json().catch(() => null);
      const p = data?.product?.[0];
      return { status: resp.status, exists: !!p, name: p?.detail?.name?.slice(0, 40) };
    }, d.macys_id);
    console.log(`  xapi: ${xapi.exists ? `EXISTS "${xapi.name}"` : `HTTP ${xapi.status}`}`);

    // Navigate to product page
    await page.goto(d.product_url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(5000); // wait for SPA React to render

    const title = await page.title().catch(() => '');
    const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
    const is404 = /page not found|we couldn't find|oops/i.test(title + bodyText);
    const isBlocked = /access denied/i.test(title);
    const isLoading = /^loading/i.test(title);
    let pageResult;
    if (isBlocked) pageResult = 'AKAMAI_BLOCK';
    else if (is404) pageResult = 'PAGE_NOT_FOUND';
    else if (isLoading) {
      // Still loading — wait more and re-check
      await sleep(5000);
      const t2 = await page.title().catch(() => '');
      const b2 = await page.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
      const is404_2 = /page not found|we couldn't find/i.test(t2 + b2);
      pageResult = is404_2 ? 'PAGE_NOT_FOUND' : 'PAGE_OK';
      console.log(`  (waited more) title: "${t2.slice(0, 60)}"`);
    } else {
      pageResult = 'PAGE_OK';
    }

    console.log(`  page: ${pageResult} | title: "${title.slice(0, 70)}"`);

    results.push({
      macys_id: d.macys_id,
      xapi_exists: xapi.exists,
      xapi_status: xapi.status,
      page: pageResult,
      title: title.slice(0, 70),
      url: d.product_url,
    });

    // Human-like delay between navigations
    await sleep(4000);
    await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);
  }

  await browser.close();

  console.log('\n\n════ MACY\'S URL VALIDATION — WARMED SESSION ════');
  for (const r of results) {
    const icon = r.page === 'PAGE_OK' ? '✅' : r.page === 'AKAMAI_BLOCK' ? '⚠️' : '❌';
    const xIcon = r.xapi_exists ? '✅' : '❌';
    console.log(`${icon} id:${r.macys_id} | xapi:${xIcon} | ${r.page} | "${r.title}"`);
  }

  const ok = results.filter(r => r.page === 'PAGE_OK').length;
  const blocked = results.filter(r => r.page === 'AKAMAI_BLOCK').length;
  const nf = results.filter(r => r.page === 'PAGE_NOT_FOUND').length;
  const xOk = results.filter(r => r.xapi_exists).length;
  console.log(`\nxapi EXISTS: ${xOk}/5 | PAGE_OK: ${ok}/5 | AKAMAI_BLOCK: ${blocked}/5 | PAGE_NOT_FOUND: ${nf}/5`);
  console.log(nf === 0 ? '✅ Zero 404s — URLs correct' : `❌ ${nf} products are real 404`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

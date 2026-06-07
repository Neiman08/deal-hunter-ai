/**
 * Macy's URL test via BrightData residential proxy.
 * Uses real residential IP to bypass Akamai bot detection.
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

  const proxyHost = process.env.PROXY_HOST || 'brd.superproxy.io';
  const proxyPort = parseInt(process.env.PROXY_PORT || '22225');
  const proxyUser = process.env.PROXY_USER;
  const proxyPass = process.env.PROXY_PASS;

  if (!proxyUser || !proxyPass) {
    console.log('ERROR: PROXY_USER or PROXY_PASS not set in .env');
    process.exit(1);
  }

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({
    headless: false,
    proxy: { server: `http://${proxyHost}:${proxyPort}`, username: proxyUser, password: proxyPass },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
  });
  const page = await ctx.newPage();

  // Warm session via proxy
  console.log('Loading Macy\'s homepage via residential proxy...');
  await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await page.title().catch(() => '');
  console.log(`Homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) {
    console.log('Still blocked via proxy. Testing URL format via xapi only.');
    // xapi test from the session
    const xapiResults = [];
    for (const d of deals) {
      const xapi = await page.evaluate(async (id) => {
        const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
        const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
        if (!resp.ok) return { status: resp.status, exists: false };
        const data = await resp.json().catch(() => null);
        const p = data?.product?.[0];
        return { status: resp.status, exists: !!p, name: p?.detail?.name?.slice(0, 40) };
      }, d.macys_id).catch(() => ({ status: 0, exists: false }));
      xapiResults.push({ id: d.macys_id, ...xapi });
      console.log(`  id:${d.macys_id} xapi: ${xapi.exists ? `EXISTS "${xapi.name}"` : `HTTP ${xapi.status}`}`);
      await sleep(500);
    }
    await browser.close();
    return;
  }
  await sleep(3000);

  const results = [];
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    console.log(`\n[${i+1}/5] id:${d.macys_id} | "${d.name?.slice(0, 45)}"`);

    await page.goto(d.product_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    const title = await page.title().catch(() => '');
    const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 400)).catch(() => '');
    const is404 = /page not found|we couldn't find|oops/i.test(title + bodyText);
    const isBlocked = /access denied/i.test(title);
    const pageResult = is404 ? 'PAGE_NOT_FOUND' : isBlocked ? 'AKAMAI_BLOCK' : 'PAGE_OK';
    console.log(`  page: ${pageResult} | title: "${title.slice(0, 70)}"`);

    results.push({ macys_id: d.macys_id, page: pageResult, title: title.slice(0, 70) });

    await sleep(3000);
    if (i < deals.length - 1) {
      await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(3000);
    }
  }

  await browser.close();

  console.log('\n════ MACY\'S PROXY URL TEST ════');
  for (const r of results) {
    const icon = r.page === 'PAGE_OK' ? '✅' : r.page === 'AKAMAI_BLOCK' ? '⚠️' : '❌';
    console.log(`${icon} id:${r.macys_id} | ${r.page} | "${r.title}"`);
  }
  const ok = results.filter(r => r.page === 'PAGE_OK').length;
  const nf = results.filter(r => r.page === 'PAGE_NOT_FOUND').length;
  console.log(`\nPAGE_OK: ${ok}/5 | PAGE_NOT_FOUND: ${nf}/5`);
  console.log(nf === 0 ? '✅ Zero 404s confirmed' : `❌ ${nf} actual 404s found`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

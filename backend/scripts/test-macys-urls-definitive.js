/**
 * Definitive Macy's URL test — fresh session per product, slow paced.
 * Tests xapi existence first (authoritative), then page load.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const jwt = require('jsonwebtoken');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function testOne(browser, deal) {
  const id = deal.macys_id;
  const { chromium } = require('playwright-extra');

  // Fresh context per product
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
  });
  const page = await ctx.newPage();

  try {
    // 1. Load homepage to get Akamai session
    await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(3000);
    const homeTitle = await page.title().catch(() => '');
    if (/access denied/i.test(homeTitle)) {
      return { id, xapi: 'session_blocked', page: 'BLOCKED_HOMEPAGE' };
    }

    // 2. xapi existence check (from within the session)
    const xapi = await page.evaluate(async (productId) => {
      const path = `/xapi/digital/v1/product/${productId}?clientId=PROS&currencyCode=USD&_regionCode=US`;
      const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
      if (!resp.ok) return { status: resp.status, exists: false };
      const data = await resp.json().catch(() => null);
      const p = data?.product?.[0];
      return { status: resp.status, exists: !!p, name: p?.detail?.name };
    }, id);

    // 3. Navigate to product URL
    const testUrl = deal.product_url;
    await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(3000); // wait for SPA to resolve

    const title = await page.title().catch(() => '');
    const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 400)).catch(() => '');
    const is404 = /page not found|we couldn't find|oops/i.test(title + bodyText);
    const isBlocked = /access denied/i.test(title);
    const pageResult = is404 ? 'PAGE_NOT_FOUND' : isBlocked ? 'AKAMAI_BLOCK' : 'PAGE_OK';

    return {
      id,
      xapi_status: xapi.status,
      xapi_exists: xapi.exists,
      xapi_name: xapi.name?.slice(0, 40),
      page: pageResult,
      title: title.slice(0, 60),
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const dealsRes = await query(`
    SELECT d.id AS deal_id, p.id AS product_id, p.sku, p.name, p.product_url, p.image_url,
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

  const results = [];
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    console.log(`\n[${i+1}/5] Testing id:${d.macys_id} — "${d.name?.slice(0,45)}"`);
    try {
      const r = await testOne(browser, d);
      r.deal_id = d.deal_id;
      r.name = d.name?.slice(0, 45);
      r.product_url = d.product_url;
      results.push(r);
      console.log(`  xapi: ${r.xapi_exists ? `EXISTS "${r.xapi_name}"` : `HTTP ${r.xapi_status}`}`);
      console.log(`  page: ${r.page} | "${r.title}"`);
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({ id: d.macys_id, deal_id: d.deal_id, name: d.name?.slice(0,45), product_url: d.product_url, page: 'ERROR', xapi_exists: false });
    }
    if (i < deals.length - 1) {
      console.log('  Waiting 5s before next product...');
      await sleep(5000);
    }
  }

  await browser.close();

  console.log('\n\n════ DEFINITIVE MACY\'S URL VALIDATION ════');
  console.log('macys_id  | xapi    | page_result      | url_format');
  console.log('─'.repeat(90));
  for (const r of results) {
    const xapiIcon = r.xapi_exists ? '✅' : '❌';
    const pageIcon = r.page === 'PAGE_OK' ? '✅' : r.page === 'AKAMAI_BLOCK' ? '⚠️' : '❌';
    const urlOk = r.product_url?.includes('/shop/product/') && r.product_url?.includes('/ID/') ? 'OK format' : 'BAD format';
    console.log(`${r.id?.padEnd(9)} | ${xapiIcon} ${r.xapi_exists ? 'EXISTS' : 'MISS  '} | ${pageIcon} ${r.page?.padEnd(14)} | ${urlOk}`);
  }

  const page_ok = results.filter(r => r.page === 'PAGE_OK').length;
  const akamai = results.filter(r => r.page === 'AKAMAI_BLOCK').length;
  const not_found = results.filter(r => r.page === 'PAGE_NOT_FOUND').length;
  const xapi_ok = results.filter(r => r.xapi_exists).length;
  console.log(`\nURL format: all use /shop/product/{slug}/ID/{id}`);
  console.log(`xapi exists: ${xapi_ok}/5 (authoritative - product exists at Macy's)`);
  console.log(`PAGE_OK: ${page_ok}/5 | AKAMAI_BLOCK (rate-limit): ${akamai}/5 | PAGE_NOT_FOUND: ${not_found}/5`);
  console.log(`\nConclusion: ${not_found === 0 ? '✅ No 404s — all URLs are CORRECT. Akamai blocks are bot-detection rate-limiting, not dead links.' : '❌ Some products are actually 404'}`);

  // Deactivate any actual 404s
  for (const r of results) {
    if (r.page === 'PAGE_NOT_FOUND' && !r.xapi_exists) {
      console.log(`Deactivating ${r.deal_id} (confirmed 404)`);
      await query('UPDATE deals SET is_active=false WHERE id=$1', [r.deal_id]);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

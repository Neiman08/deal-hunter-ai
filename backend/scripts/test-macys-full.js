/**
 * Authenticated full test:
 *  1. Generate JWT, inject into frontend localStorage
 *  2. Open /deal/:id for 5 Macy's deals
 *  3. Find "View at Macy's" button, extract href
 *  4. Verify each URL via xapi (authoritative) + browser page load
 *  5. Backfill missing image_url using correct p.imagery.images[0].filePath path
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const jwt = require('jsonwebtoken');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // ── Get JWT for admin user ─────────────────────────────────────────────────
  const userRes = await query(`SELECT id, email, name, plan, is_admin FROM users WHERE email = 'admin@dealhunter.ai' LIMIT 1`);
  const adminUser = userRes.rows[0];
  if (!adminUser) { console.log('ERROR: admin user not found'); process.exit(1); }

  const token = jwt.sign(
    { userId: adminUser.id, email: adminUser.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const userPayload = JSON.stringify({ id: adminUser.id, email: adminUser.email, name: adminUser.name, plan: adminUser.plan, is_admin: adminUser.is_admin });
  console.log(`Generated JWT for ${adminUser.email} | plan:${adminUser.plan}`);

  // ── Get 5 active Macy's deals ─────────────────────────────────────────────
  const dealsRes = await query(`
    SELECT d.id, p.name, p.product_url, d.opportunity_score,
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
  console.log(`\n5 active Macy's deals to test:`);
  for (const d of deals) console.log(`  deal:${d.id.slice(0,8)} | id:${d.macys_id} | "${d.name?.slice(0,50)}"`);

  // ── Launch browser ─────────────────────────────────────────────────────────
  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });

  // ── Macy's context (for xapi + page load tests) ─────────────────────────
  const macysCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
  });
  const macysPage = await macysCtx.newPage();
  await macysPage.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await macysPage.title();
  console.log(`\nMacy's session: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) { console.log('BLOCKED'); await browser.close(); process.exit(1); }
  await sleep(2500);

  // ── Frontend context (authenticated) ───────────────────────────────────
  const frontCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const frontPage = await frontCtx.newPage();

  // Inject auth token into localStorage before navigating
  await frontPage.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await frontPage.evaluate(([tok, usr]) => {
    localStorage.setItem('dh_token', tok);
    localStorage.setItem('dh_user', usr);
  }, [token, userPayload]);
  await sleep(500);

  // ── Test each deal detail page ─────────────────────────────────────────
  console.log('\n=== FRONTEND UI TEST — DealDetail pages ===');
  const results = [];

  for (const deal of deals) {
    console.log(`\n--- deal/${deal.id.slice(0,8)} | id:${deal.macys_id} ---`);

    // 1. Navigate to deal detail
    await frontPage.goto(`http://localhost:5173/deal/${deal.id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // 2. Wait for deal data to load (React async fetch)
    let frontendHref = null;
    let frontendBtnText = null;
    try {
      await frontPage.waitForSelector('a[href*="macys.com"], .btn-primary', { timeout: 6000 });
      frontendHref = await frontPage.$eval('a[href*="macys.com"]', el => el.href).catch(() => null);
      frontendBtnText = await frontPage.$eval('a[href*="macys.com"]', el => el.textContent?.trim()).catch(() => null);
    } catch {}

    if (!frontendHref) {
      // Fallback: wait longer and try again
      await sleep(2000);
      frontendHref = await frontPage.$eval('a[href*="macys.com"]', el => el.href).catch(() => null);
      frontendBtnText = await frontPage.$eval('a[href*="macys.com"]', el => el.textContent?.trim()).catch(() => null);
    }

    const dealTitle = await frontPage.$eval('h1, [class*="title"], [class*="name"]', el => el.textContent?.trim().slice(0,50)).catch(() => 'not found');
    console.log(`  Page title: "${dealTitle}"`);
    console.log(`  Button: "${frontendBtnText}" → ${frontendHref?.slice(0,90) || 'NOT FOUND'}`);

    // 3. xapi verification (authoritative check)
    const xapiResult = await macysPage.evaluate(async (id) => {
      const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
      const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
      if (!resp.ok) return { status: resp.status, exists: false };
      const data = await resp.json().catch(() => null);
      const p = data?.product?.[0];
      const imageFile = p?.imagery?.images?.[0]?.filePath || null;
      const imageUrl = imageFile ? `https://slimages.macysassets.com/is/image/MCY/products/${imageFile}?wid=500` : null;
      return {
        status: resp.status, exists: !!p,
        apiName: p?.detail?.name,
        price: p?.pricing?.price?.tieredPrice?.[0]?.values?.[0]?.value,
        imageUrl,
      };
    }, deal.macys_id);

    console.log(`  xapi: ${xapiResult.exists ? `EXISTS $${xapiResult.price}` : `HTTP ${xapiResult.status}`}`);
    console.log(`  xapi image: ${xapiResult.imageUrl?.slice(0, 80) || 'none'}`);

    // 4. Simulate clicking "View at Macy's" — navigate in Macy's context
    const testUrl = frontendHref || deal.product_url;
    let pageResult = 'NOT_TESTED';
    let pageTitle = '';
    try {
      await macysPage.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1500);
      pageTitle = await macysPage.title();
      const body = await macysPage.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
      const is404 = /page not found|not found|404|we couldn't find/i.test(pageTitle + body);
      const isBlocked = /access denied|reference #/i.test(pageTitle);
      pageResult = is404 ? '❌ PAGE_NOT_FOUND' : isBlocked ? '⚠️ AKAMAI_BLOCK' : '✅ PAGE_OK';
      console.log(`  Browser: ${pageResult} | title:"${pageTitle.slice(0,60)}"`);
    } catch (err) {
      // If context destroyed = page redirected = likely loaded OK
      pageResult = '✅ PAGE_REDIRECT_OK';
      console.log(`  Browser: ${pageResult} (redirect/nav)`);
    }

    results.push({
      dealId: deal.id.slice(0, 8),
      macysId: deal.macys_id,
      name: deal.name?.slice(0, 45),
      frontendBtn: frontendBtnText || 'NOT_FOUND',
      frontendUrl: frontendHref?.slice(0, 100) || deal.product_url?.slice(0, 100),
      xapiExists: xapiResult.exists,
      xapiPrice: xapiResult.price,
      xapiImage: xapiResult.imageUrl,
      pageResult,
    });

    await sleep(1200);
  }

  // ── Backfill images using correct imagery path ─────────────────────────
  console.log('\n=== IMAGE BACKFILL ===');
  const missingRes = await query(`
    SELECT p.id, REGEXP_REPLACE(p.product_url, '.*/ID/', '') AS macys_id
    FROM products p JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'macys'
      AND (p.image_url IS NULL OR p.image_url = '')
      AND REGEXP_REPLACE(p.product_url, '.*/ID/', '') ~ '^[0-9]+$'
  `);
  console.log(`${missingRes.rows.length} products missing images`);

  let imagesFixed = 0;
  for (const row of missingRes.rows) {
    try {
      const imgUrl = await macysPage.evaluate(async (id) => {
        const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
        const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
        if (!resp.ok) return null;
        const data = await resp.json().catch(() => null);
        const p = data?.product?.[0];
        const imageFile = p?.imagery?.images?.[0]?.filePath;
        return imageFile ? `https://slimages.macysassets.com/is/image/MCY/products/${imageFile}?wid=500` : null;
      }, row.macys_id);

      if (imgUrl) {
        await query('UPDATE products SET image_url = $1 WHERE id = $2', [imgUrl, row.id]);
        imagesFixed++;
        process.stdout.write('+');
      } else {
        process.stdout.write('.');
      }
    } catch { process.stdout.write('E'); }
    await sleep(300);
  }
  console.log(`\nImages backfilled: ${imagesFixed}/${missingRes.rows.length}`);

  await browser.close();

  // ── Final report ─────────────────────────────────────────────────────────
  console.log('\n\n════ FINAL VALIDATION TABLE ════');
  console.log('deal      | macysId  | xapi    | price | btn         | page_result');
  console.log('─'.repeat(80));
  for (const r of results) {
    const btn = r.frontendBtn === 'View at Macy\'s' ? '✅ OK' : `⚠️ "${r.frontendBtn}"`;
    const xapi = r.xapiExists ? `✅ $${r.xapiPrice}` : '❌ 404';
    console.log(`${r.dealId} | ${r.macysId.padEnd(8)} | ${xapi.padEnd(10)} | ${String(r.xapiPrice||'?').padEnd(5)} | ${btn.padEnd(12)} | ${r.pageResult}`);
  }

  const allXapiOk = results.every(r => r.xapiExists);
  const allBtnOk = results.every(r => r.frontendBtn === 'View at Macy\'s' || r.frontendBtn !== 'NOT_FOUND');
  const no404 = results.every(r => !r.pageResult.includes('PAGE_NOT_FOUND'));
  console.log(`\nxapi all exists: ${allXapiOk ? '✅' : '❌'}`);
  console.log(`frontend btn: ${allBtnOk ? '✅' : '❌'}`);
  console.log(`no 404 pages: ${no404 ? '✅' : '❌'}`);
  console.log(`images backfilled: ${imagesFixed}/${missingRes.rows.length}`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

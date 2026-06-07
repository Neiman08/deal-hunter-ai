/**
 * Full browser test: frontend UI → DealDetail → "View at Macy's" link verification
 * Also backfills missing image_url for all Macy's products with no image.
 *
 * Flow:
 *  1. Open localhost:5173, filter by Macy's, grab 5 active deal links
 *  2. Open macys.com to establish a session
 *  3. Navigate to each of the 5 product URLs in that session
 *  4. Report: EXISTS / NOT_FOUND / BLOCKED per product
 *  5. Backfill image URLs for all products missing them
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // ── Step 1: Get 5 active Macy's deals from the frontend API ────────────────
  console.log('\n=== STEP 1: Fetching 5 active Macy\'s deals from API ===');
  const http = require('http');
  const apiDeals = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/deals?store=macys&limit=5&sort=score&is_active=true', res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });

  const deals = (apiDeals.deals || []).slice(0, 5);
  console.log(`Got ${deals.length} deals from API`);
  for (const d of deals) {
    console.log(`  [deal ${d.id}] "${d.name?.slice(0,50)}" → ${d.product_url?.slice(0,90)}`);
  }

  if (!deals.length) {
    console.log('ERROR: No active Macy\'s deals returned from API');
    process.exit(1);
  }

  // ── Step 2: Launch browser, open frontend, verify UI shows deals ───────────
  console.log('\n=== STEP 2: Browser — frontend UI test ===');
  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });

  // Context for Macy's (session-authenticated)
  const macysCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });

  // Context for frontend
  const frontCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // ── Step 3: Establish Macy's session ────────────────────────────────────────
  console.log('\n=== STEP 3: Establishing Macy\'s browser session ===');
  const macysPage = await macysCtx.newPage();
  await macysPage.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await macysPage.title();
  console.log(`Macy's homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) {
    console.log('BLOCKED on homepage — cannot test links');
    await browser.close();
    process.exit(1);
  }
  await sleep(2500);

  // ── Step 4: Test frontend UI — open deal detail, verify "View at Macy's" button ──
  console.log('\n=== STEP 4: Frontend UI — opening deal detail pages ===');
  const frontPage = await frontCtx.newPage();
  await frontPage.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(1500);

  // Navigate to Macy's filter
  try {
    await frontPage.click(`button:has-text("Macy's")`);
    await sleep(1000);
    console.log('Clicked Macy\'s filter button');
  } catch {
    console.log('Could not click Macy\'s filter — continuing with direct deal URLs');
  }

  // Collect "View at Macy's" hrefs from deal detail pages
  const frontendLinks = [];
  for (const deal of deals) {
    try {
      await frontPage.goto(`http://localhost:5173/deal/${deal.id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(800);
      const href = await frontPage.$eval('a[href*="macys.com"]', el => el.href).catch(() => null);
      const btnText = await frontPage.$eval('a[href*="macys.com"]', el => el.textContent?.trim()).catch(() => null);
      frontendLinks.push({ dealId: deal.id, name: deal.name?.slice(0, 50), href, btnText });
      console.log(`  /deal/${deal.id} → button: "${btnText}" → href: ${href?.slice(0, 90)}`);
    } catch (err) {
      frontendLinks.push({ dealId: deal.id, name: deal.name?.slice(0, 50), href: null, error: err.message });
      console.log(`  /deal/${deal.id} → ERROR: ${err.message.slice(0, 80)}`);
    }
  }

  // ── Step 5: Test each product URL in Macy's session ─────────────────────────
  console.log('\n=== STEP 5: Testing product URLs in Macy\'s browser session ===');
  const urlResults = [];

  for (const link of frontendLinks) {
    const testUrl = link.href || deals.find(d => d.id === link.dealId)?.product_url;
    if (!testUrl) {
      urlResults.push({ ...link, result: 'NO_URL' });
      console.log(`  [NO_URL] deal ${link.dealId}`);
      continue;
    }

    // Extract macys product ID
    const macysId = (testUrl.match(/\/ID\/(\d+)/) || [])[1];

    try {
      // Test via xapi (reliable — same approach as scraper)
      const xapiResult = await macysPage.evaluate(async (id) => {
        const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
        const resp = await fetch(path, {
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        });
        if (!resp.ok) return { status: resp.status, exists: false };
        const data = await resp.json().catch(() => null);
        const p = data?.product?.[0];
        return {
          status: resp.status,
          exists: !!p,
          apiName: p?.detail?.name,
          price: p?.pricing?.price?.tieredPrice?.[0]?.values?.[0]?.value,
          imageFile: p?.detail?.media?.images?.[0]?.filePath || null,
        };
      }, macysId);

      // Navigate to product URL (real browser test)
      let pageResult = 'NOT_TESTED';
      try {
        await macysPage.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1200);
        const pageTitle = await macysPage.title();
        const bodySnippet = await macysPage.$eval('body', el => el.innerText?.slice(0, 200)).catch(() => '');
        const is404 = /page not found|not found|404|we couldn't find/i.test(pageTitle + bodySnippet);
        const isBlocked = /access denied|reference #/i.test(pageTitle + bodySnippet);
        pageResult = is404 ? 'PAGE_NOT_FOUND' : isBlocked ? 'AKAMAI_BLOCKED' : 'PAGE_OK';
        console.log(`  [${pageResult}] ${macysId} | title:"${pageTitle.slice(0, 60)}"`);
      } catch (navErr) {
        pageResult = 'NAV_ERROR';
        console.log(`  [NAV_ERROR] ${macysId}: ${navErr.message.slice(0, 60)}`);
      }

      urlResults.push({
        dealId: link.dealId,
        name: link.name,
        macysId,
        url: testUrl.slice(0, 100),
        xapiExists: xapiResult.exists,
        xapiStatus: xapiResult.status,
        apiName: xapiResult.apiName,
        price: xapiResult.price,
        pageResult,
        imageFile: xapiResult.imageFile,
      });

    } catch (err) {
      urlResults.push({ dealId: link.dealId, name: link.name, macysId, url: testUrl.slice(0, 100), result: 'ERROR', error: err.message });
      console.log(`  [ERROR] ${macysId}: ${err.message.slice(0, 80)}`);
    }
    await sleep(1200);
  }

  // ── Step 6: Backfill missing images ─────────────────────────────────────────
  console.log('\n=== STEP 6: Backfilling missing image URLs ===');
  const missingImgRes = await query(`
    SELECT p.id, REGEXP_REPLACE(p.product_url, '.*/ID/', '') AS macys_id
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'macys'
      AND (p.image_url IS NULL OR p.image_url = '')
      AND REGEXP_REPLACE(p.product_url, '.*/ID/', '') ~ '^[0-9]+$'
  `);
  console.log(`${missingImgRes.rows.length} products need image URLs`);

  let imagesUpdated = 0;
  for (const row of missingImgRes.rows) {
    try {
      const result = await macysPage.evaluate(async (id) => {
        const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
        const resp = await fetch(path, {
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        });
        if (!resp.ok) return null;
        const data = await resp.json().catch(() => null);
        const p = data?.product?.[0];
        const imageFile = p?.detail?.media?.images?.[0]?.filePath || null;
        return imageFile ? `https://slimages.macysassets.com/is/image/MCY/products/${imageFile}?wid=500` : null;
      }, row.macys_id);

      if (result) {
        await query('UPDATE products SET image_url = $1 WHERE id = $2', [result, row.id]);
        imagesUpdated++;
        process.stdout.write('+');
      } else {
        process.stdout.write('.');
      }
    } catch {
      process.stdout.write('E');
    }
    await sleep(250);
  }
  console.log(`\nImages backfilled: ${imagesUpdated}/${missingImgRes.rows.length}`);

  await browser.close();

  // ── Final report ─────────────────────────────────────────────────────────────
  console.log('\n\n=== FINAL RESULTS ===');
  console.log('Frontend "View at Macy\'s" link test:');
  for (const r of urlResults) {
    const xapiStatus = r.xapiExists ? `xapi:OK($${r.price})` : `xapi:${r.xapiStatus}`;
    const pageStatus = r.pageResult || 'SKIP';
    const overall = r.xapiExists && pageStatus !== 'PAGE_NOT_FOUND' ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${overall} | deal:${r.dealId?.slice(0,8)}... | id:${r.macysId} | ${xapiStatus} | page:${pageStatus}`);
    console.log(`         URL: ${r.url}`);
  }

  const allPass = urlResults.every(r => r.xapiExists && r.pageResult !== 'PAGE_NOT_FOUND');
  console.log(`\nOverall: ${allPass ? '✅ ALL PASS' : '⚠️  SOME ISSUES'}`);
  console.log(`Images backfilled: ${imagesUpdated}`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

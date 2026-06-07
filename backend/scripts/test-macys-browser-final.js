/**
 * Final Macy's URL validation — real browser, real clicks.
 * Opens 5 active deals in Deal Hunter AI frontend,
 * clicks "View at Macy's", confirms the page loads (not 404).
 * Also tests URL format alternatives if needed.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const jwt = require('jsonwebtoken');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // Get admin JWT
  const userRes = await query(`SELECT id, email, name, plan, is_admin FROM users WHERE email = 'admin@dealhunter.ai' LIMIT 1`);
  const adminUser = userRes.rows[0];
  if (!adminUser) { console.log('ERROR: admin user not found'); process.exit(1); }

  const token = jwt.sign(
    { userId: adminUser.id, email: adminUser.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const userPayload = JSON.stringify({
    id: adminUser.id, email: adminUser.email,
    name: adminUser.name, plan: adminUser.plan, is_admin: adminUser.is_admin
  });

  // Get 5 active Macy's deals
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
  console.log(`\nTesting ${deals.length} active Macy's deals...`);

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });

  // Macy's session (for page load tests)
  const macysCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
  });
  const macysPage = await macysCtx.newPage();
  await macysPage.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await macysPage.title().catch(() => '');
  console.log(`Macy's session: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) { await browser.close(); process.exit(1); }
  await sleep(2000);

  // Frontend session (authenticated)
  const frontCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const frontPage = await frontCtx.newPage();
  await frontPage.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await frontPage.evaluate(([tok, usr]) => {
    localStorage.setItem('dh_token', tok);
    localStorage.setItem('dh_user', usr);
  }, [token, userPayload]);
  await sleep(500);

  const results = [];

  for (const deal of deals) {
    console.log(`\n--- ${deal.macys_id} | "${deal.name?.slice(0, 50)}" ---`);

    // Navigate to deal detail in frontend
    await frontPage.goto(`http://localhost:5173/deal/${deal.deal_id}`, {
      waitUntil: 'domcontentloaded', timeout: 15000
    });
    await sleep(2500);

    // Find "View at Macy's" button
    let frontendHref = null;
    try {
      await frontPage.waitForSelector('a[href*="macys.com"]', { timeout: 5000 });
      frontendHref = await frontPage.$eval('a[href*="macys.com"]', el => el.href).catch(() => null);
    } catch {}

    if (!frontendHref) {
      await sleep(2000);
      frontendHref = await frontPage.$eval('a[href*="macys.com"]', el => el.href).catch(() => null);
    }

    console.log(`  Frontend button URL: ${frontendHref || 'NOT FOUND'}`);

    // Test URL in Macy's browser session
    const testUrl = frontendHref || deal.product_url;
    let pageResult = 'NOT_TESTED';
    let finalTitle = '';
    let is404 = false;

    if (testUrl) {
      try {
        await macysPage.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await sleep(2000);
        finalTitle = await macysPage.title().catch(() => '');
        const bodyText = await macysPage.$eval('body', el => el.innerText?.slice(0, 500)).catch(() => '');
        is404 = /page not found|not found|404|we couldn't find|oops/i.test(finalTitle + bodyText);
        const isBlocked = /access denied|reference #/i.test(finalTitle);
        pageResult = is404 ? 'PAGE_NOT_FOUND' : isBlocked ? 'AKAMAI_BLOCK' : 'PAGE_OK';
      } catch (err) {
        pageResult = 'NAV_ERROR: ' + err.message.slice(0, 50);
      }
    }

    console.log(`  Page result: ${pageResult} | title: "${finalTitle?.slice(0, 60)}"`);

    // If 404, try alternative URL formats
    let workingUrl = pageResult === 'PAGE_OK' ? testUrl : null;
    if (is404 || pageResult === 'PAGE_NOT_FOUND') {
      const id = deal.macys_id;
      const altFormats = [
        `https://www.macys.com/shop/product/ID/${id}`,
        `https://www.macys.com/shop/product?ID=${id}`,
      ];
      console.log('  Product is 404 — testing alternative URL formats...');
      for (const altUrl of altFormats) {
        try {
          await macysPage.goto(altUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(1500);
          const t = await macysPage.title().catch(() => '');
          const body = await macysPage.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
          const altIs404 = /page not found|not found|404|we couldn't find/i.test(t + body);
          console.log(`    ${altUrl.slice(0, 80)} → ${altIs404 ? '404' : 'OK'} | "${t.slice(0, 50)}"`);
          if (!altIs404) { workingUrl = altUrl; break; }
        } catch {}
        await sleep(800);
      }
    }

    results.push({
      deal_id: deal.deal_id,
      product_id: deal.product_id,
      sku: deal.sku,
      macys_id: deal.macys_id,
      name: deal.name?.slice(0, 50),
      db_url: deal.product_url,
      frontend_url: frontendHref,
      page_result: pageResult,
      page_title: finalTitle?.slice(0, 60),
      working_url: workingUrl,
    });

    await sleep(1200);
  }

  await browser.close();

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('\n\n════ FINAL MACY\'S URL VALIDATION ════');
  console.log('deal_id  | macys_id  | result          | title');
  console.log('─'.repeat(90));
  for (const r of results) {
    const icon = r.page_result === 'PAGE_OK' ? '✅' : r.page_result === 'AKAMAI_BLOCK' ? '⚠️' : '❌';
    console.log(`${icon} ${r.deal_id.slice(0,8)} | ${r.macys_id.padEnd(9)} | ${r.page_result.padEnd(15)} | "${r.page_title}"`);
  }

  const ok = results.filter(r => r.page_result === 'PAGE_OK').length;
  const blocked = results.filter(r => r.page_result === 'AKAMAI_BLOCK').length;
  const notFound = results.filter(r => r.page_result === 'PAGE_NOT_FOUND').length;
  console.log(`\nPAGE_OK: ${ok}/5 | AKAMAI_BLOCK: ${blocked}/5 | PAGE_NOT_FOUND: ${notFound}/5`);

  // Fix any 404 products
  for (const r of results) {
    if (r.page_result === 'PAGE_NOT_FOUND' && !r.working_url) {
      console.log(`\nDeactivating deal ${r.deal_id.slice(0,8)} (product ${r.macys_id} confirmed 404)`);
      await query('UPDATE deals SET is_active=false WHERE id=$1', [r.deal_id]);
    }
    if (r.page_result === 'PAGE_NOT_FOUND' && r.working_url) {
      console.log(`\nUpdating URL for product ${r.macys_id} to: ${r.working_url}`);
      await query('UPDATE products SET product_url=$1 WHERE id=$2', [r.working_url, r.product_id]);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

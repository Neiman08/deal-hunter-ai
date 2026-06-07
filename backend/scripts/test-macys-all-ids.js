/**
 * Checks ALL Macy's numeric product IDs via xapi.
 * Reports which exist, which are 404, and their actual names.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // Get all Macy's products with numeric IDs
  const res = await query(`
    SELECT p.id, p.name, p.product_url,
      REGEXP_REPLACE(p.product_url, '.*/ID/', '') AS macys_id
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'macys'
      AND REGEXP_REPLACE(p.product_url, '.*/ID/', '') ~ '^[0-9]+$'
    ORDER BY p.id
  `);

  console.log(`Testing ${res.rows.length} numeric-ID Macy's products via xapi...`);

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
  });
  const page = await ctx.newPage();

  await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await page.title();
  console.log(`Homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) { console.log('BLOCKED'); await browser.close(); process.exit(1); }
  await sleep(3000);

  const results = { exists: [], not_found: [], error: [] };

  for (const row of res.rows) {
    const apiPath = `/xapi/digital/v1/product/${row.macys_id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
    try {
      const result = await page.evaluate(async (path) => {
        const resp = await fetch(path, {
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        });
        return { status: resp.status, data: resp.ok ? await resp.json().catch(() => null) : null };
      }, apiPath);

      if (result.data?.product?.[0]) {
        const p = result.data.product[0];
        results.exists.push({ dbId: row.id, macysId: row.macys_id, apiName: p.detail?.name });
        process.stdout.write('.');
      } else {
        results.not_found.push({ dbId: row.id, macysId: row.macys_id, dbName: row.name, http: result.status });
        process.stdout.write('X');
      }
    } catch (err) {
      results.error.push({ dbId: row.id, macysId: row.macys_id, error: err.message.slice(0, 60) });
      process.stdout.write('E');
    }
    await sleep(400);
  }

  await browser.close();

  console.log(`\n\n=== RESULTS ===`);
  console.log(`EXISTS: ${results.exists.length}`);
  console.log(`NOT_FOUND (404): ${results.not_found.length}`);
  for (const r of results.not_found) console.log(`  404: ${r.macysId} "${r.dbName}"`);
  console.log(`ERRORS: ${results.error.length}`);

  // Output IDs for DB cleanup
  const badIds = results.not_found.map(r => r.dbId);
  console.log(`\nDB IDs to disable: ${JSON.stringify(badIds)}`);

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

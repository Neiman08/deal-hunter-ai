/**
 * Test Macy's product IDs via xapi (same approach as macys.js scraper).
 * Opens homepage, then fetch()es xapi for each product ID from within the browser session.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TEST_IDS = [
  { id: '17344848', name: 'Women Sleeveless Top' },
  { id: '10296891', name: 'Le Creuset French Oven' },
  { id: '24629062', name: 'Women Sandals' },
  { id: '25560767', name: 'Women Shorts' },
  { id: '11224794', name: 'Women Jeans' },
  // Fake IDs
  { id: 'LC-FO-5-RED', name: 'FAKE Le Creuset' },
  { id: 'CK-TOTE-BLK', name: 'FAKE Calvin Klein' },
];

async function main() {
  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  console.log('Loading macys.com homepage...');
  await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await page.title();
  console.log(`Homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) {
    console.log('BLOCKED'); await browser.close(); process.exit(1);
  }
  await sleep(3000);

  const results = [];
  for (const t of TEST_IDS) {
    const apiPath = `/xapi/digital/v1/product/${t.id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
    try {
      const result = await page.evaluate(async (path) => {
        const resp = await fetch(path, {
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        });
        return { status: resp.status, data: resp.ok ? await resp.json().catch(() => null) : null };
      }, apiPath);

      if (result.data?.product?.[0]) {
        const p = result.data.product[0];
        const name = p.detail?.name || '?';
        const price = p.pricing?.price?.tieredPrice?.[0]?.values?.[0]?.value;
        const available = p.availability?.available;
        const deptPath = p.taxonomy?.categories?.[0]?.path || p.detail?.parentheticals || [];
        results.push({ id: t.id, status: 'EXISTS', name, price, available, dept: JSON.stringify(deptPath).slice(0, 100) });
        console.log(`[EXISTS] ${t.id} | "${name}" | $${price} | avail:${available} | dept:${JSON.stringify(deptPath).slice(0,80)}`);
      } else {
        results.push({ id: t.id, status: `NOT_FOUND (HTTP ${result.status})` });
        console.log(`[NOT_FOUND] ${t.id} — HTTP ${result.status}`);
      }
    } catch (err) {
      results.push({ id: t.id, status: 'ERROR', error: err.message });
      console.log(`[ERROR] ${t.id}: ${err.message.slice(0, 100)}`);
    }
    await sleep(800);
  }

  await browser.close();
  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(JSON.stringify(r));
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

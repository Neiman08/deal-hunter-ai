/**
 * Check xapi imagery field structure + test /deal/:id route
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MACYS_ID = '12306961';

async function main() {
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
  await sleep(2500);

  const imagery = await page.evaluate(async (id) => {
    const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
    const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const p = data?.product?.[0];
    return {
      imageryKeys: p?.imagery ? Object.keys(p.imagery).slice(0, 10) : null,
      imageryRaw: JSON.stringify(p?.imagery).slice(0, 500),
    };
  }, MACYS_ID);

  console.log('imagery field:', JSON.stringify(imagery, null, 2));
  await browser.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });

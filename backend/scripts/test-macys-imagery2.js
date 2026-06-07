/**
 * Check xapi p.imagery field structure
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const title = await page.title();
  if (/access denied/i.test(title)) { console.log('BLOCKED'); await browser.close(); process.exit(1); }
  await sleep(2500);

  const result = await page.evaluate(async () => {
    const ids = ['12306961', '22630996', '24629062'];
    const out = [];
    for (const id of ids) {
      const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
      const resp = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
      if (!resp.ok) { out.push({ id, status: resp.status }); continue; }
      const data = await resp.json().catch(() => null);
      const p = data?.product?.[0];
      const im = p?.imagery;
      out.push({
        id,
        imageryType: typeof im,
        imageryIsArray: Array.isArray(im),
        imageryKeys: im ? (Array.isArray(im) ? `array[${im.length}]` : Object.keys(im).slice(0,8)) : null,
        firstEntry: im ? JSON.stringify(Array.isArray(im) ? im[0] : Object.values(im)[0]).slice(0, 300) : null,
        name: p?.detail?.name,
      });
      await new Promise(r => setTimeout(r, 400));
    }
    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });

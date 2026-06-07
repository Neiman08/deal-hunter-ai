/**
 * Quick test: verify 3 Macy's URLs load correctly (not Page Not Found).
 * Opens macys.com homepage first to establish session, then checks product pages.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TEST_URLS = [
  { id: '17344848', name: 'Women Sleeveless Top', url: 'https://www.macys.com/shop/product/women-s-sweetheart-neck-sleeveless-top-created-for-macy-s/ID/17344848' },
  { id: '10296891', name: 'Le Creuset French Oven', url: 'https://www.macys.com/shop/product/le-creuset-signature-enameled-cast-iron-5-qt-round-french-oven/ID/10296891' },
  { id: '24629062', name: 'Women Sandals', url: 'https://www.macys.com/shop/product/women-s-holly-cherries-slip-on-sandals/ID/24629062' },
  // Fake IDs — should fail
  { id: 'LC-FO-5-RED', name: 'Le Creuset FAKE', url: 'https://www.macys.com/shop/product/le-creuset-signature-5-qt-round-dutch-oven/ID/LC-FO-5-RED' },
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

  // Establish session on homepage
  console.log('Loading macys.com homepage...');
  await page.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await page.title();
  console.log(`Homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) {
    console.log('BLOCKED on homepage');
    await browser.close();
    process.exit(1);
  }
  await sleep(2000);

  const results = [];
  for (const t of TEST_URLS) {
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      const title = await page.title();
      const finalUrl = page.url();
      const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');

      const is404 = /page not found|not found|404|we couldn't find/i.test(title + bodyText);
      const isBlocked = /access denied|akamai|robot/i.test(title + bodyText);
      const status = is404 ? '404_NOT_FOUND' : isBlocked ? 'BLOCKED' : 'OK';

      results.push({ id: t.id, name: t.name, status, title, finalUrl: finalUrl.slice(0, 120) });
      console.log(`[${status}] ${t.id} | title: "${title.slice(0, 80)}" | url: ${finalUrl.slice(0, 100)}`);
    } catch (err) {
      results.push({ id: t.id, name: t.name, status: 'ERROR', error: err.message });
      console.log(`[ERROR] ${t.id}: ${err.message.slice(0, 100)}`);
    }
    await sleep(1500);
  }

  await browser.close();

  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(`${r.id}: ${r.status}${r.status === 'OK' ? '' : ' — ' + (r.error || r.title || '')}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

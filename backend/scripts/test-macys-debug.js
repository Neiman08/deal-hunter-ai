/**
 * Debug: check frontend button rendering timing + actual xapi image field structure
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Known valid deal ID with product_url confirmed
const DEAL_ID = '738965f2-62ca-43cc-a7a4-ade0a6f3a73f'; // Men's Cardigan, ID 12306961
const MACYS_ID = '12306961';

async function main() {
  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });

  // ── Context 1: Macy's session ──────────────────────────────────────────────
  const macysCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
  });
  const macysPage = await macysCtx.newPage();
  await macysPage.goto('https://www.macys.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const homeTitle = await macysPage.title();
  console.log(`Homepage: "${homeTitle}"`);
  if (/access denied/i.test(homeTitle)) { console.log('BLOCKED'); await browser.close(); process.exit(1); }
  await sleep(2500);

  // ── Debug 1: xapi image field structure ───────────────────────────────────
  console.log('\n=== xapi image structure debug ===');
  const xapiDebug = await macysPage.evaluate(async (id) => {
    const path = `/xapi/digital/v1/product/${id}?clientId=PROS&currencyCode=USD&_regionCode=US`;
    const resp = await fetch(path, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!resp.ok) return { status: resp.status };
    const data = await resp.json().catch(() => null);
    const p = data?.product?.[0];
    if (!p) return { noProduct: true };
    // Return raw media structure
    return {
      hasDetail: !!p.detail,
      hasMedia: !!p.detail?.media,
      mediaKeys: Object.keys(p.detail?.media || {}),
      imagesArray: p.detail?.media?.images?.slice(0, 3),
      imageXsData: p.detail?.media?.image?.slice?.(0, 3),
      altImgField: Object.keys(p).filter(k => k.toLowerCase().includes('image') || k.toLowerCase().includes('media')),
      name: p.detail?.name,
    };
  }, MACYS_ID);
  console.log('xapi media structure:', JSON.stringify(xapiDebug, null, 2));

  // ── Context 2: Frontend ───────────────────────────────────────────────────
  console.log('\n=== Frontend DealDetail button debug ===');
  const frontCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const frontPage = await frontCtx.newPage();
  await frontPage.goto(`http://localhost:5173/deal/${DEAL_ID}`, { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Wait for the deal data to load (React async)
  try {
    await frontPage.waitForSelector('a[href*="macys"], [href*="macys"]', { timeout: 8000 });
    const href = await frontPage.$eval('a[href*="macys"]', el => el.href);
    const text = await frontPage.$eval('a[href*="macys"]', el => el.textContent?.trim());
    console.log(`Button found: "${text}" → ${href}`);
  } catch {
    // Try broader selectors
    const allLinks = await frontPage.$$eval('a', els => els.map(a => ({ href: a.href, text: a.textContent?.trim().slice(0,30) })));
    const extLinks = allLinks.filter(l => l.href && !l.href.includes('localhost'));
    console.log('External links found on page:', extLinks.length);
    for (const l of extLinks.slice(0, 5)) console.log(' ', l);

    // Check if deal loaded at all
    const h1 = await frontPage.$eval('h1, [class*="name"], [class*="title"]', el => el.textContent?.slice(0,60)).catch(() => 'NOT_FOUND');
    console.log('Deal name on page:', h1);

    // Get current page source snippet
    const bodyText = await frontPage.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
    console.log('Body snippet:', bodyText.slice(0, 200));
  }

  await browser.close();
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

require('dotenv').config();
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  const xapiHits = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/xapi/') && !url.includes('header') && !url.includes('footer') &&
        !url.includes('switches') && !url.includes('stores') && !url.includes('preferences')) {
      xapiHits.push({ type: 'REQ', method: req.method(), url });
    }
  });
  page.on('response', async res => {
    const url = res.url();
    if (res.status() === 200 && url.includes('/xapi/') &&
        !url.includes('header') && !url.includes('footer') &&
        !url.includes('switches') && !url.includes('stores') && !url.includes('preferences')) {
      const text = await res.text().catch(() => '');
      xapiHits.push({ type: 'RES', url, preview: text.slice(0, 400) });
    }
  });

  await page.goto('https://www.macys.com/', { waitUntil: 'networkidle', timeout: 45000 }).catch(e => {
    console.log('goto warn:', e.message.slice(0, 60));
  });
  console.log('Homepage:', await page.title().catch(() => '?'));
  await sleep(2000);

  // SPA route push
  console.log('Pushing SPA route /shop/sale/last-act...');
  await page.evaluate(() => {
    history.pushState({}, '', '/shop/sale/last-act?id=33490');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  });
  await sleep(6000);

  // Try clicking a sale link in the nav
  const links = await page.$$eval('a', els =>
    els.filter(a => (a.href||'').includes('/shop/sale')).map(a => a.href).slice(0, 3)
  ).catch(() => []);
  console.log('Sale links found:', links);

  if (links[0]) {
    console.log('Clicking:', links[0]);
    await page.evaluate((href) => { history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, links[0]);
    await sleep(6000);
  }

  console.log('\nXHR hits:', xapiHits.length);
  for (const h of xapiHits.slice(0, 15)) {
    console.log(`[${h.type}] ${h.url.slice(0, 180)}`);
    if (h.preview) console.log('  ' + h.preview.slice(0, 150));
  }

  await browser.close();
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

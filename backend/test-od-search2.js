require('dotenv').config();
const { chromium } = require('playwright');

async function main() {
  // Build ISP proxy config directly (same as browserEngine)
  const proxyConfig = {
    server: `http://${process.env.ISP_PROXY_HOST}:${process.env.ISP_PROXY_PORT || '33335'}`,
    username: process.env.ISP_PROXY_USER,
    password: process.env.ISP_PROXY_PASS,
  };
  console.log('ISP proxy configured:', proxyConfig.server, '| user:', proxyConfig.username?.slice(0,20)+'...');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      // HTTP/1.1 forced — avoids HTTP2 protocol error with proxy
      '--disable-http2',
    ],
    proxy: proxyConfig,
    channel: 'chrome',
  });

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'max-age=0',
    },
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const page = await ctx.newPage();

  const testUrls = [
    'https://www.officedepot.com/a/search/?q=clearance+laptop',
    'https://www.officedepot.com/a/search/?q=clearance+chair',
    'https://www.officedepot.com/a/search/?q=clearance+printer',
  ];

  for (const url of testUrls) {
    try {
      console.log('\nTesting:', url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(10000);
      
      // Multiple scrolls
      for (let i = 0; i < 5; i++) {
        await page.evaluate(i => window.scrollTo(0, 600 * i), i+1);
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(3000);

      const result = await page.evaluate(() => {
        const cards = document.querySelectorAll('[class*="product-card"], [class*="ProductCard"], article[class*="product"]');
        const saleUrls = [];
        const allProductUrls = new Set();
        
        document.querySelectorAll('a[href*="/a/products/"]').forEach(a => {
          const href = a.href.split('?')[0];
          allProductUrls.add(href);
          const card = a.closest('[class*="product-card"], [class*="ProductCard"], article');
          if (card) {
            const hasSale = card.querySelector('.od-price-reg, .od-price-default-red, [class*="od-price-red"], [class*="sale-price"]');
            if (hasSale) saleUrls.push(href);
          }
        });
        
        // Also check for any "% off" text on page
        const bodyText = document.body.innerText;
        const offMatches = bodyText.match(/\d+%\s*off/gi) || [];
        const regPrices = document.querySelectorAll('.od-price-reg').length;
        const saleRedPrices = document.querySelectorAll('.od-price-default-red, [class*="od-price-red"]').length;
        
        return {
          title: document.title.slice(0,60),
          cardCount: cards.length,
          totalProductUrls: allProductUrls.size,
          saleUrls: saleUrls.slice(0, 5),
          saleUrlCount: saleUrls.length,
          regPricesFound: regPrices,
          saleRedPricesFound: saleRedPrices,
          offMentions: offMatches.slice(0,5),
          bodyLength: bodyText.length,
        };
      });
      
      console.log('  title:', result.title);
      console.log('  cards:', result.cardCount, '| productUrls:', result.totalProductUrls, '| saleUrls:', result.saleUrlCount);
      console.log('  od-price-reg:', result.regPricesFound, '| od-price-red:', result.saleRedPricesFound);
      console.log('  bodyLength:', result.bodyLength);
      if (result.saleUrls.length) result.saleUrls.forEach(u => console.log('  SALE URL:', u.split('/products/')[1]?.slice(0,50)));
      if (result.offMentions.length) console.log('  % off mentions:', result.offMentions.join(', '));
    } catch(e) {
      console.log('  ERROR:', e.message.slice(0,80));
    }
  }

  await browser.close();
  console.log('\nDone.');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

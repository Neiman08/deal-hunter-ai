require('dotenv').config();
const { newBestBuyContext } = require('./src/services/browserEngine');

// OD sale/clearance/deals candidate pages
const PAGES = [
  'https://www.officedepot.com/category/deals/',
  'https://www.officedepot.com/category/clearance/',
  'https://www.officedepot.com/category/clearance/technology/',
  'https://www.officedepot.com/category/clearance/furniture-decor/',
  'https://www.officedepot.com/category/deals/weekly-ad/',
  'https://www.officedepot.com/category/deals/hot-deals/',
];

async function testPage(url) {
  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    // Scroll to load lazy products
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      // Count product cards with and without sale
      let totalCards = 0, saleCards = 0;
      const saleUrls = [];

      document.querySelectorAll('[class*="od-product-card"]').forEach(card => {
        totalCards++;
        const hasSale = card.querySelector('.od-price-reg, .od-price-default-red, [class*="od-price-red"]');
        const link = card.querySelector('a[href*="/a/products/"]');
        if (hasSale && link) {
          saleCards++;
          saleUrls.push(link.href.split('?')[0]);
        }
      });

      // Also check any product links visible
      const allLinks = new Set();
      document.querySelectorAll('a[href*="/a/products/"]').forEach(a => allLinks.add(a.href.split('?')[0]));

      return { totalCards, saleCards, saleUrls: saleUrls.slice(0, 5), totalLinks: allLinks.size, title: document.title };
    });

    console.log(`\n[${url.split('/').slice(-3,-1).join('/')}]`);
    console.log(`  title: ${result.title.slice(0,60)}`);
    console.log(`  product cards: ${result.totalCards} | sale cards: ${result.saleCards} | total product links: ${result.totalLinks}`);
    if (result.saleUrls.length) {
      console.log('  sample sale URLs:');
      result.saleUrls.forEach(u => console.log('    ' + u.split('/products/')[1]?.slice(0,60)));
    }
    return result;
  } catch(e) {
    console.log(`[${url}] ERROR: ${e.message.slice(0,60)}`);
    return null;
  } finally {
    await page.close().catch(()=>{});
    await ctx.close().catch(()=>{});
  }
}

(async () => {
  for (const url of PAGES) await testPage(url);
  console.log('\nDone.');
  process.exit(0);
})();

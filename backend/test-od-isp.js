require('dotenv').config();
const { newIspContext } = require('./src/services/browserEngine');

const TEST_PAGES = [
  'https://www.officedepot.com/category/clearance/',
  'https://www.officedepot.com/category/deals/',
  'https://www.officedepot.com/a/search/?q=clearance+laptop',
  'https://www.officedepot.com/b/deal-center/N-538744',
];

async function testPage(url) {
  const ctx  = await newIspContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { window.scrollBy(0, 2000); });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      const saleCards = [], allLinks = new Set();
      document.querySelectorAll('[class*="od-product-card"], [class*="product-card"]').forEach(card => {
        const hasSale = card.querySelector('.od-price-reg, .od-price-default-red, [class*="od-price-red"]');
        const link    = card.querySelector('a[href*="/a/products/"]');
        if (link) { allLinks.add(link.href.split('?')[0]); if (hasSale) saleCards.push(link.href.split('?')[0]); }
      });
      // Also get any product links in page
      document.querySelectorAll('a[href*="/a/products/"]').forEach(a => allLinks.add(a.href.split('?')[0]));
      return { title: document.title.slice(0,60), cards: document.querySelectorAll('[class*="product-card"]').length, saleUrls: saleCards.slice(0,5), totalLinks: allLinks.size };
    });

    console.log(`\n[${url.split('/').slice(-3).join('/')}]`);
    console.log(`  title: ${result.title}`);
    console.log(`  productCards: ${result.cards} | saleCards: ${result.saleUrls.length} | allLinks: ${result.totalLinks}`);
    if (result.saleUrls.length) result.saleUrls.forEach(u => console.log('  sale:', u.split('/products/')[1]?.slice(0,50)));
    return result;
  } catch(e) {
    console.log(`\n[${url}] ERROR: ${e.message.slice(0,80)}`);
    return null;
  } finally {
    await page.close().catch(()=>{});
    await ctx.close().catch(()=>{});
  }
}

(async () => {
  for (const url of TEST_PAGES) await testPage(url);
  console.log('\nDone.');
  process.exit(0);
})();

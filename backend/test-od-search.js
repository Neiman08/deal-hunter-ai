require('dotenv').config();
const { newIspContext } = require('./src/services/browserEngine');

const SEARCH_URLS = [
  'https://www.officedepot.com/a/search/?q=clearance+laptop',
  'https://www.officedepot.com/a/search/?q=clearance+office+chair',
  'https://www.officedepot.com/a/search/?q=sale+monitor',
  'https://www.officedepot.com/a/search/?q=clearance+printer',
];

async function testSearch(url) {
  const ctx  = await newIspContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    // Wait for React to render
    await page.waitForTimeout(8000);
    // Scroll to trigger lazy load
    for (let i = 0; i < 4; i++) {
      await page.evaluate(i => window.scrollTo(0, 800 * i), i+1);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      // Check all possible product card selectors OD might use
      const selectors = [
        '[class*="od-product-card"]',
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '[data-testid*="product"]',
        '[class*="plp-card"]',  // product list page card
        '.s7-product-list-item',
        '[class*="od-product"]',
        '[class*="search-result"]',
        '.product',
        'article',
      ];
      
      const counts = {};
      selectors.forEach(sel => {
        counts[sel] = document.querySelectorAll(sel).length;
      });
      
      // All product links
      const productLinks = new Set();
      document.querySelectorAll('a[href*="/a/products/"]').forEach(a => {
        const href = a.href.split('?')[0];
        if (href.includes('/a/products/')) productLinks.add(href);
      });
      
      // Check for sale indicators
      const saleIndicators = {
        'od-price-reg': document.querySelectorAll('.od-price-reg').length,
        'od-price-default-red': document.querySelectorAll('.od-price-default-red').length,
        'od-price-red': document.querySelectorAll('[class*="od-price-red"]').length,
        'strikethrough': document.querySelectorAll('[class*="strikethrough"], del, s').length,
        'was-price': document.querySelectorAll('[class*="was-price"], [class*="wasPrice"]').length,
        'sale-price': document.querySelectorAll('[class*="sale-price"], [class*="salePrice"]').length,
      };

      // Check for any price-related elements at all
      const allPriceEls = document.querySelectorAll('[class*="price"]').length;
      
      return {
        title: document.title.slice(0,60),
        url: window.location.href,
        selectorCounts: counts,
        productLinks: [...productLinks].slice(0,5),
        totalProductLinks: productLinks.size,
        saleIndicators,
        allPriceEls,
        bodyLength: document.body.innerText.length,
      };
    });
    
    console.log(`\n[${url.split('?')[1]}]`);
    console.log(`  title: ${result.title}`);
    console.log(`  bodyLength: ${result.bodyLength} | priceEls: ${result.allPriceEls}`);
    console.log(`  productLinks: ${result.totalProductLinks}`);
    console.log(`  saleIndicators:`, JSON.stringify(result.saleIndicators));
    // Show non-zero selectors
    const nonZero = Object.entries(result.selectorCounts).filter(([,v])=>v>0);
    if (nonZero.length) console.log(`  nonZeroSelectors:`, nonZero.map(([k,v])=>k+'='+v).join(', '));
    if (result.productLinks.length) result.productLinks.forEach(u => console.log('  link:', u.split('/products/')[1]?.slice(0,50)));
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
  for (const url of SEARCH_URLS) await testSearch(url);
  console.log('\nDone.');
  process.exit(0);
})();

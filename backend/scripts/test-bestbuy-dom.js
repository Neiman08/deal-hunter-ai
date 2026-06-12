/**
 * Diagnostic: probe actual Best Buy search page DOM selectors
 * Usage: node backend/scripts/test-bestbuy-dom.js [keyword]
 */

const { newBestBuyContext } = require('../src/services/browserEngine');

const KEYWORD = process.argv[2] || 'clearance laptop';

async function main() {
  console.log('═'.repeat(60));
  console.log(`  BB DOM Probe — "${KEYWORD}"`);
  console.log('═'.repeat(60));

  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();

  try {
    const url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(KEYWORD)}`;
    console.log(`\n[1] Navigating: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`    title: "${await page.title()}"`);
    console.log(`    url:   ${page.url()}`);

    // Wait a bit for React to render
    await page.waitForTimeout(5000);

    console.log('\n[2] Probing card selectors...');
    const selectorResults = await page.evaluate(() => {
      const selectors = [
        'li.sku-item',
        '.sku-item',
        '[data-testid="product-card"]',
        '[data-testid*="shop-product-card"]',
        '[data-testid*="product"]',
        'div[data-sku-id]',
        '[class*="sku-item"]',
        '[class*="SkuItem"]',
        '[class*="product-item"]',
        '[class*="ProductItem"]',
        '[class*="product-tile"]',
        '[class*="ProductTile"]',
        '[class*="grid-cell"]',
        '[class*="GridCell"]',
        'a[href*="/site/"][href*=".p"]',
      ];

      return selectors.map(sel => ({
        selector: sel,
        count: document.querySelectorAll(sel).length,
      }));
    });

    selectorResults.forEach(r => {
      const found = r.count > 0 ? `✅ ${r.count}` : '❌  0';
      console.log(`    ${found.padEnd(8)} ${r.selector}`);
    });

    // Sample the actual class names of first product cards
    console.log('\n[3] Sampling first product link hrefs (a[href*="/site/"])...');
    const sampleLinks = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/site/"][href*=".p"]')];
      return links.slice(0, 5).map(a => ({
        href: a.getAttribute('href'),
        ariaLabel: (a.getAttribute('aria-label') || '').slice(0, 60),
        parentTag: a.parentElement?.tagName,
        parentClass: (a.parentElement?.className || '').slice(0, 80),
        grandparentTag: a.parentElement?.parentElement?.tagName,
        grandparentClass: (a.parentElement?.parentElement?.className || '').slice(0, 80),
      }));
    });

    if (sampleLinks.length) {
      console.log(`    Found ${sampleLinks.length} product links:`);
      sampleLinks.forEach((l, i) => {
        // Extract SKU from href
        const skuFromQuery = l.href?.match(/skuId=(\d{5,8})/)?.[1];
        const skuFromSite  = l.href?.match(/\/site\/.+?\/(\d{5,8})\.p/)?.[1];
        const sku = skuFromQuery || skuFromSite || '(no SKU)';

        console.log(`\n    [${i}] href: ${l.href?.slice(0, 90)}`);
        console.log(`        sku:   ${sku}`);
        console.log(`        label: ${l.ariaLabel || '(none)'}`);
        console.log(`        parent: <${l.parentTag} class="${l.parentClass}">`);
        console.log(`        grandparent: <${l.grandparentTag} class="${l.grandparentClass}">`);
      });
    } else {
      console.log('    ❌ No /site/ links found — page may be blocked');
    }

    // Check for CAPTCHA or access denied
    console.log('\n[4] Block check...');
    const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');
    const blocked  = /captcha|robot|access denied|verify you are human/i.test(bodyText);
    console.log(blocked ? `    ❌ BLOCKED: "${bodyText.slice(0, 100)}"` : '    ✅ Not blocked');

    // Sample raw HTML of one product card area
    console.log('\n[5] First product card HTML (2000 chars)...');
    const cardHtml = await page.evaluate(() => {
      const link = document.querySelector('a[href*="/site/"][href*=".p"]');
      if (!link) return '(no link found)';
      // Walk up to find the product container
      let el = link;
      for (let i = 0; i < 8; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        if (el.querySelectorAll('a[href*="/site/"]').length <= 2 &&
            (el.querySelector('[class*="price"], [data-testid*="price"]'))) {
          return el.outerHTML.slice(0, 2000);
        }
      }
      // Fallback: return 5 levels up
      let x = link;
      for (let i = 0; i < 5; i++) x = x.parentElement || x;
      return x.outerHTML.slice(0, 2000);
    }).catch(() => '(error)');

    console.log('\n' + cardHtml.slice(0, 2000));

  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
    process.exit(0);
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

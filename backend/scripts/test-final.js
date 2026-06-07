/**
 * Final approach tests:
 * - HD: single browser session + batched GraphQL from page.evaluate
 * - Macy's: residential proxy browser session (not tried yet)
 */
require('dotenv').config();
const { newBestBuyContext, newMacysContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const HD_SEARCH_QUERY = `
query searchModel($keyword:String!,$storeId:String,$startIndex:Int,$pageSize:Int) {
  searchModel(keyword:$keyword,storeId:$storeId) {
    metadata { total }
    products(startIndex:$startIndex,pageSize:$pageSize) {
      itemId
      identifiers { productLabel brandName modelNumber canonicalUrl }
      pricing(storeId:$storeId) { value original specialBuyPrice }
    }
  }
}`;

// ─── HD: single browser page + multiple GraphQL calls ─────────────────────────
async function testHDSinglePageGraphQL() {
  console.log('\n━━━ HOME DEPOT — single page + batched GraphQL ━━━');
  const STORE_ID = process.env.HD_STORE_ID || '6906';

  const ctx = await newBestBuyContext();
  const page = await ctx.newPage();

  try {
    console.log('  Loading homedepot.com...');
    await page.goto('https://www.homedepot.com', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    const title = await page.title().catch(() => '?');
    console.log(`  Title: "${title}"`);

    if (title.includes('Access Denied') || title.includes('Error')) {
      console.log('  ❌ Blocked on homepage. Cannot proceed.');
      await ctx.close();
      return null;
    }

    // Now call GraphQL for multiple keywords from this page context
    const keywords = ['power tools', 'generators', 'dewalt drill', 'appliances clearance'];
    const allProducts = [];

    for (const kw of keywords) {
      const result = await page.evaluate(async ({ keyword, storeId, query }) => {
        try {
          const res = await fetch('/federation-gateway/graphql?opname=searchModel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              operationName: 'searchModel',
              variables: { keyword, storeId, startIndex: 0, pageSize: 24 },
              query,
            }),
          });
          const json = await res.json();
          return {
            total: json?.data?.searchModel?.metadata?.total,
            products: json?.data?.searchModel?.products || [],
            error: json?.errors?.[0]?.message,
          };
        } catch (e) { return { error: e.message, products: [] }; }
      }, { keyword: kw, storeId: STORE_ID, query: HD_SEARCH_QUERY });

      if (result.error) {
        console.log(`  ❌ "${kw}": ${result.error}`);
      } else {
        console.log(`  ✅ "${kw}": total=${result.total}, got ${result.products.length} products`);
        if (result.products[0]) {
          const p = result.products[0];
          console.log(`     sample: "${p.identifiers?.productLabel}" $${p.pricing?.value} (orig $${p.pricing?.original})`);
        }
        allProducts.push(...result.products.map(p => ({
          itemId: p.itemId,
          name: p.identifiers?.productLabel,
          brand: p.identifiers?.brandName,
          url: `https://www.homedepot.com${p.identifiers?.canonicalUrl || `/p/${p.itemId}`}`,
          currentPrice: p.pricing?.value,
          originalPrice: p.pricing?.original,
          specialBuyPrice: p.pricing?.specialBuyPrice,
        })));
      }
    }

    const deduped = [...new Map(allProducts.map(p => [p.itemId, p])).values()];
    console.log(`\n  Total unique products: ${deduped.length}`);
    require('fs').writeFileSync('/tmp/hd-products.json', JSON.stringify(deduped.slice(0, 20), null, 2));
    await ctx.close();
    return deduped;
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    await ctx.close();
    return null;
  }
}

// ─── Macy's: residential proxy (not tried yet for browser) ───────────────────
async function testMacysResidential() {
  console.log('\n━━━ MACY\'S — residential proxy browser ━━━');

  let ctx;
  try {
    ctx = await newMacysContext();
    console.log('  Using residential proxy (newMacysContext)');
  } catch(e) {
    console.log(`  ⚠️  Could not launch Macy's context: ${e.message}`);
    return null;
  }

  const page = await ctx.newPage();
  const productUrls = [];

  page.on('response', async res => {
    const url = res.url();
    if (res.status() === 200 && url.includes('/xapi/') && !url.includes('.js')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const text = await res.text().catch(() => '');
          if (text.includes('"productId"') || text.includes('"products":')) {
            console.log(`  🛒 Product API found: ${url.slice(0, 120)}`);
            console.log(`     ${text.slice(0, 200)}`);
            require('fs').writeFileSync('/tmp/macys-product-api.json', JSON.stringify({ url, body: text.slice(0, 2000) }, null, 2));
          }
        }
      } catch {}
    }
  });

  try {
    await page.goto('https://www.macys.com/shop/sale/last-act', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await sleep(6000);
    const title = await page.title().catch(() => '?');
    console.log(`  Title: "${title}"`);

    if (!title.includes('Access Denied')) {
      // Try to extract product URLs from rendered page
      const urls = await page.evaluate(() => {
        return [...document.querySelectorAll('a[href*="/shop/product"]')]
          .map(a => a.href).filter(Boolean).slice(0, 20);
      });
      console.log(`  Product links found: ${urls.length}`);
      if (urls.length) {
        console.log(`  Sample: ${urls.slice(0, 3).join('\n         ')}`);
        productUrls.push(...urls);
      }
    }
  } catch (e) {
    console.log(`  warn: ${e.message.slice(0, 80)}`);
  }

  await ctx.close();
  return productUrls;
}

async function main() {
  const hdProducts = await testHDSinglePageGraphQL();
  const macysProducts = await testMacysResidential();

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`  HD products via GraphQL: ${hdProducts?.length ?? 'BLOCKED'}`);
  console.log(`  Macy\'s products: ${macysProducts?.length ?? 'BLOCKED'}`);
  console.log('\n✅ Done.');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

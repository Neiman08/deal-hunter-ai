/**
 * Test HD GraphQL directly from Node.js (no CORS in Node),
 * and Macy's with a real browser session using domcontentloaded.
 */
require('dotenv').config();
const https = require('https');
const { newBestBuyContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── HD GraphQL direct HTTP (Node bypasses CORS) ─────────────────────────────
function hdGraphQL(operationName, variables, query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ operationName, variables, query });
    const req = https.request({
      hostname: 'www.homedepot.com',
      path: `/federation-gateway/graphql?opname=${operationName}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.homedepot.com',
        'Referer': 'https://www.homedepot.com/',
        'X-Current-Url': '/s/power+tools',
        'X-Experience-Name': 'general-merchandise',
        'apollographql-client-name': 'general-merchandise',
        'apollographql-client-version': '0.0.1',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data.slice(0, 800) }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const SEARCH_QUERY = `
query searchModel($keyword:String!,$storeId:String,$startIndex:Int,$pageSize:Int,$sortOrder:String,$sortOrderDesc:Boolean) {
  searchModel(keyword:$keyword,storeId:$storeId) {
    metadata { total }
    products(startIndex:$startIndex,pageSize:$pageSize,sortOrder:$sortOrder,sortOrderDesc:$sortOrderDesc) {
      itemId
      identifiers { productLabel brandName modelNumber canonicalUrl }
      pricing(storeId:$storeId) { value original specialBuyPrice }
      availabilityType { discontinued type }
    }
  }
}`;

async function testHDGraphQL() {
  console.log('\n━━━ HOME DEPOT GraphQL DIRECT HTTP TEST ━━━');
  const STORE_ID = process.env.HD_STORE_ID || '6906';

  const keywords = ['power tools clearance', 'generators sale', 'appliances'];
  for (const kw of keywords) {
    try {
      const r = await hdGraphQL('searchModel', {
        keyword: kw, storeId: STORE_ID, startIndex: 0, pageSize: 10,
      }, SEARCH_QUERY);

      console.log(`  [${r.status}] keyword="${kw}"`);
      if (r.body?.data?.searchModel?.products) {
        const prods = r.body.data.searchModel.products;
        const total = r.body.data.searchModel.metadata?.total;
        console.log(`  ✅ total=${total} | first product: "${prods[0]?.identifiers?.productLabel}" $${prods[0]?.pricing?.value}`);
      } else if (r.body?.errors) {
        console.log(`  ❌ errors: ${JSON.stringify(r.body.errors).slice(0,200)}`);
      } else {
        console.log(`  raw: ${(r.raw||JSON.stringify(r.body||{})).slice(0,200)}`);
      }
    } catch (e) {
      console.log(`  ❌ ${kw}: ${e.message}`);
    }
  }
}

// ─── Macy's via real browser with fast networkidle ────────────────────────────
async function testMacysDirectBrowser() {
  console.log('\n━━━ MACY\'S BROWSER INTERCEPT (no proxy, domcontentloaded) ━━━');
  const ctx = await newBestBuyContext(); // no proxy — Macy's is less aggressive for direct connections
  const page = await ctx.newPage();

  const apiHits = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/xapi/') && !url.includes('.css') && !url.includes('.js')) {
      apiHits.push({ type: 'req', method: req.method(), url });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    if (res.status() === 200 && url.includes('/xapi/') &&
        !url.includes('.js') && !url.includes('.css')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const text = await res.text();
          apiHits.push({ type: 'res', url, preview: text.slice(0, 500) });
        }
      } catch {}
    }
  });

  try {
    await page.goto('https://www.macys.com/shop/sale/last-act?id=33490', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await sleep(6000); // wait for XHR after DOM
    console.log(`  Title: ${await page.title().catch(()=>'?')}`);
  } catch (e) {
    console.log(`  goto warn: ${e.message.slice(0, 80)}`);
  }

  console.log(`\n  Found ${apiHits.length} xapi calls:`);
  const seen = new Set();
  for (const h of apiHits) {
    const base = h.url.split('?')[0];
    if (!seen.has(base)) {
      seen.add(base);
      console.log(`  [${h.type.toUpperCase()}] ${h.url.slice(0, 180)}`);
      if (h.preview) {
        const hasProducts = h.preview.includes('productId') || h.preview.includes('"id"') ||
                            h.preview.includes('upcNumber') || h.preview.includes('"products"');
        if (hasProducts) console.log(`    🛒 Contains product data!`);
        console.log(`    ${h.preview.slice(0, 120)}`);
      }
    }
  }

  require('fs').writeFileSync('/tmp/macys-xapi-hits.json', JSON.stringify(apiHits.slice(0, 20), null, 2));
  await ctx.close();
  return apiHits;
}

async function main() {
  await testHDGraphQL();
  await testMacysDirectBrowser();
  console.log('\n✅ Done. Check /tmp/macys-xapi-hits.json for full Macy\'s data.');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

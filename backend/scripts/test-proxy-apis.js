/**
 * Test HD GraphQL via BrightData residential proxy,
 * and Macy's product API via ISP proxy with domcontentloaded.
 */
require('dotenv').config();
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { newIspContext, newResidentialContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Proxy configs
const RESIDENTIAL_PROXY = `http://brd-customer-hl_baafcac4-zone-residential_proxy1-country-us:p1p2vbv91h3i@brd.superproxy.io:22225`;
const ISP_PROXY         = `http://brd-customer-hl_baafcac4-zone-isp_proxy1:nr7vcaopm8zt@brd.superproxy.io:33335`;

const SEARCH_QUERY = `
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

function hdGraphQLViaProxy(proxyUrl, operationName, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ operationName, variables, query: SEARCH_QUERY });
    const agent = new HttpsProxyAgent(proxyUrl);
    const req = https.request({
      hostname: 'www.homedepot.com',
      path: `/federation-gateway/graphql?opname=${operationName}`,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.homedepot.com',
        'Referer': 'https://www.homedepot.com/',
        'apollographql-client-name': 'general-merchandise',
        'apollographql-client-version': '0.0.1',
        'X-Experience-Name': 'general-merchandise',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 25000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data.slice(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function testHDViaResidentialProxy() {
  console.log('\n━━━ HOME DEPOT GraphQL via RESIDENTIAL PROXY ━━━');
  const STORE_ID = process.env.HD_STORE_ID || '6906';

  for (const kw of ['power tools', 'generators', 'dewalt']) {
    try {
      const r = await hdGraphQLViaProxy(RESIDENTIAL_PROXY, 'searchModel', {
        keyword: kw, storeId: STORE_ID, startIndex: 0, pageSize: 5,
      });
      console.log(`  [${r.status}] "${kw}"`);
      if (r.body?.data?.searchModel?.products) {
        const prods = r.body.data.searchModel.products;
        const total = r.body.data.searchModel.metadata?.total;
        console.log(`  ✅ total=${total} | sample: "${prods[0]?.identifiers?.productLabel}" $${prods[0]?.pricing?.value}`);
        require('fs').writeFileSync('/tmp/hd-gql-proxy-hit.json', JSON.stringify({ kw, total, products: prods }, null, 2));
        break; // Found it, stop probing
      } else if (r.body?.errors) {
        console.log(`  ❌ errors: ${JSON.stringify(r.body.errors).slice(0,200)}`);
      } else {
        console.log(`  raw: ${(r.raw||'').slice(0,150)}`);
      }
    } catch (e) {
      console.log(`  ❌ "${kw}": ${e.message}`);
    }
  }
}

// Macy's: intercept xapi calls during page load with ISP proxy + domcontentloaded
async function testMacysWithDomContentLoaded() {
  console.log('\n━━━ MACY\'S ISP PROXY + domcontentloaded ━━━');

  // Try to get a context - first ISP, fallback to no proxy
  let ctx;
  try {
    ctx = await newIspContext();
    console.log('  Using ISP proxy');
  } catch(e) {
    const { newBestBuyContext } = require('../src/services/browserEngine');
    ctx = await newBestBuyContext();
    console.log('  Fallback to no-proxy browser');
  }

  const page = await ctx.newPage();
  const apiHits = [];

  page.on('response', async res => {
    const url = res.url();
    const status = res.status();
    if (status === 200 && url.includes('/xapi/') && !url.includes('.js') && !url.includes('.css')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const text = await res.text().catch(() => '');
          const hasProds = text.includes('"productId"') || text.includes('"products":[') ||
                           text.includes('upcNumber') || text.includes('"id":');
          apiHits.push({ url, preview: text.slice(0, 400), hasProds });
        }
      } catch {}
    }
  });

  const testUrls = [
    'https://www.macys.com/shop/sale/last-act',
    'https://www.macys.com/shop/clearance',
    'https://www.macys.com/shop/sale?id=2626',
  ];

  for (const u of testUrls) {
    try {
      console.log(`  Trying: ${u}`);
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(5000); // Wait for XHR after DOM
      const title = await page.title().catch(() => '?');
      console.log(`  Title: "${title}"`);
      if (!title.includes('Access Denied') && !title.includes('Error')) break;
    } catch (e) {
      console.log(`  warn: ${e.message.slice(0, 70)}`);
    }
  }

  console.log(`\n  API hits: ${apiHits.length}`);
  for (const h of apiHits.slice(0, 10)) {
    console.log(`  ${h.hasProds ? '🛒' : '  '} [${h.url.slice(0,160)}]`);
    if (h.hasProds) {
      console.log(`     ${h.preview.slice(0, 200)}`);
    }
  }

  require('fs').writeFileSync('/tmp/macys-dce-hits.json', JSON.stringify(apiHits.slice(0, 20), null, 2));
  await ctx.close();
  return apiHits;
}

async function main() {
  await testHDViaResidentialProxy();
  await testMacysWithDomContentLoaded();
  console.log('\n✅ Done.');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

/**
 * Probe Macy's xapi and HD GraphQL directly.
 */
require('dotenv').config();

const https = require('https');
const { newBestBuyContext, newIspContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(opts.headers || {}),
      },
      timeout: 15000,
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
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── Macy's xapi probe ─────────────────────────────────────────────────────────
async function probeMacysApi() {
  console.log('\n━━━ MACY\'S xapi PROBE ━━━');

  // Known Macy's xapi patterns based on the header intercept showing /xapi/navigate/v1/
  const endpoints = [
    // Product search/browse APIs
    'https://www.macys.com/xapi/v4/browse?id=2626&edge=browse&limit=40&offset=0&sortBy=PRICE_LOW_TO_HIGH&_requestSource=desktop&_shoppingMode=SITE',
    'https://www.macys.com/xapi/v4/product/search?categoryId=2626&edge=browse&limit=24&offset=0&sort=PRICE_LOW_TO_HIGH&_requestSource=desktop',
    'https://www.macys.com/xapi/navigate/v1/page/category?id=2626&_shoppingMode=SITE&_deviceType=DESKTOP&_regionCode=US&_sortBy=PRICE_LOW_TO_HIGH',
    'https://www.macys.com/xapi/navigate/v1/search?keyword=sale+clearance&_shoppingMode=SITE&_deviceType=DESKTOP&_regionCode=US&limit=40',
    'https://www.macys.com/xapi/v4/search?keyword=clearance&_shoppingMode=SITE&limit=40',
  ];

  for (const url of endpoints) {
    try {
      const r = await fetchJson(url);
      console.log(`  [${r.status}] ${url.slice(0, 100)}`);
      if (r.status === 200 && r.body) {
        const keys = Object.keys(r.body).join(', ');
        console.log(`    keys: ${keys.slice(0, 100)}`);
        // Check if it has products
        const hasProducts = JSON.stringify(r.body).includes('productId') ||
                            JSON.stringify(r.body).includes('products') ||
                            JSON.stringify(r.body).includes('upcNumber');
        if (hasProducts) {
          console.log(`    ✅ HAS PRODUCTS! Saving...`);
          require('fs').writeFileSync('/tmp/macys-api-hit.json', JSON.stringify({ url, body: r.body }, null, 2));
        }
      } else {
        console.log(`    raw: ${(r.raw||'').slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`  [ERR] ${url.slice(0, 80)}: ${e.message}`);
    }
  }
}

// ─── Home Depot GraphQL probe via Playwright ──────────────────────────────────
async function probeHDGraphQL() {
  console.log('\n━━━ HOME DEPOT GraphQL PROBE ━━━');
  const ctx = await newBestBuyContext();
  const page = await ctx.newPage();

  const gqlCalls = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('federation-gateway')) {
      const body = req.postData() || '';
      try {
        const parsed = JSON.parse(body);
        gqlCalls.push({
          url, opName: parsed.operationName,
          vars: parsed.variables,
          query: (parsed.query || '').slice(0, 500),
        });
      } catch {
        gqlCalls.push({ url, raw: body.slice(0, 300) });
      }
    }
  });

  try {
    // Navigate to search page — this triggers searchModel GraphQL
    console.log('  Loading homedepot.com search: power tools...');
    await page.goto('https://www.homedepot.com/s/power%20tools?Nao=0', {
      waitUntil: 'networkidle', timeout: 40000
    });
    await sleep(3000);
    console.log(`  Title: ${await page.title().catch(()=>'?')}`);

    console.log('  Loading homedepot.com search: generators...');
    await page.goto('https://www.homedepot.com/s/generators', {
      waitUntil: 'networkidle', timeout: 40000
    });
    await sleep(2000);
  } catch (e) {
    console.log(`  Nav warn: ${e.message.slice(0,80)}`);
  }

  console.log(`\n  Intercepted ${gqlCalls.length} GraphQL calls:`);
  const seen = new Set();
  for (const c of gqlCalls) {
    if (c.opName && !seen.has(c.opName)) {
      seen.add(c.opName);
      console.log(`  ✅ opName="${c.opName}"`);
      console.log(`     vars: ${JSON.stringify(c.vars||{}).slice(0,200)}`);
      console.log(`     query[0:200]: ${(c.query||'').slice(0,200)}`);
    }
  }

  require('fs').writeFileSync('/tmp/hd-gql-calls.json', JSON.stringify(gqlCalls.slice(0,10), null, 2));
  await ctx.close();
  return gqlCalls;
}

async function main() {
  await probeMacysApi();
  let hdCalls = [];
  try { hdCalls = await probeHDGraphQL(); }
  catch(e) { console.error('HD probe error:', e.message); }

  console.log('\n✅ Probe complete.');
  console.log('HD GQL calls saved to /tmp/hd-gql-calls.json');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

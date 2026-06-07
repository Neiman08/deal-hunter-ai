/**
 * API interception script — finds Macy's and Home Depot internal endpoints.
 * Navigates to sale/category pages, logs all XHR/fetch calls, extracts JSON APIs.
 */
require('dotenv').config();

const { newIspContext, newBestBuyContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function interceptMacys() {
  console.log('\n━━━ MACY\'S API INTERCEPT ━━━');
  const ctx = await newIspContext();
  const page = await ctx.newPage();

  const apiCalls = [];

  // Intercept all XHR/fetch requests
  page.on('request', req => {
    const url = req.url();
    if (
      (url.includes('/api/') || url.includes('graphql') || url.includes('/xapi/') ||
       url.includes('/search') || url.includes('/catalog') || url.includes('/product')) &&
      !url.includes('.css') && !url.includes('.js') && !url.includes('analytics') &&
      !url.includes('track') && !url.includes('beacon')
    ) {
      apiCalls.push({ type: 'request', method: req.method(), url: url.slice(0, 200) });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    const status = res.status();
    if (
      status === 200 &&
      (url.includes('/api/') || url.includes('graphql') || url.includes('/xapi/') ||
       url.includes('/search') || url.includes('/catalog')) &&
      !url.includes('.js') && !url.includes('.css')
    ) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await res.text().catch(() => '');
          const preview = body.slice(0, 300);
          apiCalls.push({ type: 'response', url: url.slice(0, 200), preview });
        }
      } catch {}
    }
  });

  try {
    console.log('  Navigating to macys.com/shop/sale...');
    await page.goto('https://www.macys.com/shop/sale?id=2626', { waitUntil: 'networkidle', timeout: 45000 });
    await sleep(5000);
    console.log(`  Title: ${await page.title()}`);

    // Scroll to trigger lazy loads
    await page.evaluate(() => window.scrollBy(0, 1500));
    await sleep(3000);
    await page.evaluate(() => window.scrollBy(0, 1500));
    await sleep(3000);
  } catch (e) {
    console.log(`  Nav error: ${e.message}`);
  }

  console.log(`\n  Found ${apiCalls.length} API calls:`);
  for (const c of apiCalls.filter(c => c.type === 'response').slice(0, 20)) {
    console.log(`  [RESPONSE] ${c.url}`);
    console.log(`    preview: ${c.preview.slice(0, 150)}`);
  }

  // Also check requests
  const requests = apiCalls.filter(c => c.type === 'request');
  console.log(`\n  Requests intercepted (${requests.length}):`);
  for (const r of requests.slice(0, 20)) {
    console.log(`  [${r.method}] ${r.url}`);
  }

  await ctx.close();
  return apiCalls;
}

async function interceptHomeDepot() {
  console.log('\n━━━ HOME DEPOT GraphQL INTERCEPT ━━━');
  const ctx = await newBestBuyContext();
  const page = await ctx.newPage();

  const gqlCalls = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes('federation-gateway') || url.includes('graphql')) {
      const body = req.postData() || '';
      gqlCalls.push({ type: 'req', url: url.slice(0, 200), body: body.slice(0, 400) });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('federation-gateway') || url.includes('graphql')) {
      try {
        const body = await res.text().catch(() => '');
        gqlCalls.push({ type: 'res', url: url.slice(0, 200), preview: body.slice(0, 400) });
      } catch {}
    }
  });

  try {
    console.log('  Navigating to homedepot.com/b/tools/N-5yc1vZc1xyz...');
    // Use a known category page
    await page.goto('https://www.homedepot.com/b/Tools/N-5yc1vZc1xyz', { waitUntil: 'networkidle', timeout: 45000 });
    await sleep(5000);
    console.log(`  Title: ${await page.title()}`);

    // Also try search
    await page.goto('https://www.homedepot.com/s/dewalt%20drill', { waitUntil: 'networkidle', timeout: 45000 });
    await sleep(5000);
  } catch (e) {
    console.log(`  Nav error: ${e.message}`);
  }

  console.log(`\n  GraphQL calls found (${gqlCalls.length}):`);
  for (const c of gqlCalls.filter(c => c.type === 'req').slice(0, 15)) {
    console.log(`  [REQ] ${c.url}`);
    if (c.body.includes('operationName')) {
      try {
        const parsed = JSON.parse(c.body);
        console.log(`    opName: ${parsed.operationName}`);
        console.log(`    vars: ${JSON.stringify(parsed.variables).slice(0, 150)}`);
      } catch {
        console.log(`    body: ${c.body.slice(0, 150)}`);
      }
    }
  }

  await ctx.close();
  return gqlCalls;
}

async function main() {
  console.log('Starting API interception...\n');

  let macysData;
  try {
    macysData = await interceptMacys();
  } catch(e) {
    console.error('Macy\'s intercept failed:', e.message);
    macysData = [];
  }

  let hdData;
  try {
    hdData = await interceptHomeDepot();
  } catch(e) {
    console.error('HD intercept failed:', e.message);
    hdData = [];
  }

  // Save raw data for analysis
  const fs = require('fs');
  fs.writeFileSync('/tmp/macys-api-calls.json', JSON.stringify(macysData.slice(0, 30), null, 2));
  fs.writeFileSync('/tmp/hd-graphql-calls.json', JSON.stringify(hdData.slice(0, 30), null, 2));

  console.log('\n✅ Intercept complete. Data saved to /tmp/macys-api-calls.json and /tmp/hd-graphql-calls.json');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

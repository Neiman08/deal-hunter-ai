require('dotenv').config();
const { newBestBuyContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const ctx = await newBestBuyContext();
  const page = await ctx.newPage();

  const calls = [];
  page.on('request', req => {
    if (req.url().includes('federation-gateway')) {
      const body = req.postData() || '';
      try {
        const p = JSON.parse(body);
        calls.push({ op: p.operationName, vars: p.variables, query: (p.query||'').slice(0,600) });
      } catch { calls.push({ raw: body.slice(0,300) }); }
    }
  });

  try {
    console.log('Step 1: Load homepage (domcontentloaded)...');
    await page.goto('https://www.homedepot.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    console.log('Step 2: Navigate to search page...');
    await page.goto('https://www.homedepot.com/s/power%20tools', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    const title = await page.title().catch(()=>'?');
    console.log(`Title: "${title}"`);
  } catch(e) {
    console.log(`warn: ${e.message.slice(0,70)}`);
  }

  console.log(`\nIntercepted ${calls.length} GraphQL calls:`);
  const seen = new Set();
  for (const c of calls) {
    if (c.op && !seen.has(c.op)) {
      seen.add(c.op);
      console.log(`\n  opName: "${c.op}"`);
      console.log(`  vars: ${JSON.stringify(c.vars||{}).slice(0,200)}`);
      // Show key fields in query
      const fields = (c.query||'').match(/\w+(?=\(|\{|$)/g)?.slice(0,15).join(', ');
      console.log(`  query fields: ${fields}`);
      console.log(`  query[0:300]: ${(c.query||'').slice(0,300)}`);
    }
  }

  require('fs').writeFileSync('/tmp/hd-search-gql.json', JSON.stringify(calls.slice(0,5), null, 2));
  await ctx.close();
  console.log('\n✅ Done. Full data in /tmp/hd-search-gql.json');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

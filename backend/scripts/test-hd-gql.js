require('dotenv').config();
const { newBestBuyContext } = require('../src/services/browserEngine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const STORE_ID = process.env.HD_STORE_ID || '6906';

const Q = `query searchModel($keyword:String!,$storeId:String,$startIndex:Int,$pageSize:Int){
  searchModel(keyword:$keyword,storeId:$storeId){
    metadata{total}
    products(startIndex:$startIndex,pageSize:$pageSize){
      itemId
      identifiers{productLabel brandName modelNumber canonicalUrl}
      pricing(storeId:$storeId){value original specialBuyPrice}
    }
  }
}`;

async function main() {
  const ctx = await newBestBuyContext();
  const page = await ctx.newPage();

  try {
    console.log('Loading homedepot.com...');
    await page.goto('https://www.homedepot.com', { waitUntil: 'networkidle', timeout: 40000 });
  } catch(e) {
    console.log(`goto warn: ${e.message.slice(0,60)}`);
  }

  const title = await page.title().catch(()=>'?');
  console.log(`Title: "${title}"`);

  if (title.toLowerCase().includes('access denied') || title.includes('Error')) {
    console.log('❌ Blocked on homepage.');
    await ctx.close(); process.exit(1);
  }

  // Raw GraphQL call with full response logging
  console.log('\nCalling searchModel for "power tools"...');
  const raw = await page.evaluate(async ({ keyword, storeId, query }) => {
    try {
      const res = await fetch('/federation-gateway/graphql?opname=searchModel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          operationName: 'searchModel',
          variables: { keyword, storeId, startIndex: 0, pageSize: 5 },
          query,
        }),
      });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 1500) };
    } catch(e) { return { error: e.message }; }
  }, { keyword: 'power tools', storeId: STORE_ID, query: Q });

  console.log(`Status: ${raw.status}`);
  console.log(`Body: ${raw.body || raw.error}`);

  await ctx.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

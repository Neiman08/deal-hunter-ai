require('dotenv').config();
const https = require('https');

function fetchText(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res({ status: r.statusCode, body: d.slice(0, 3000) }));
    }).on('error', rej);
  });
}

async function main() {
  // 1. Check robots.txt for sitemaps
  console.log('=== robots.txt ===');
  const robots = await fetchText('https://www.officedepot.com/robots.txt');
  console.log('Status:', robots.status);
  const sitemapLines = robots.body.split('\n').filter(l => l.toLowerCase().includes('sitemap'));
  console.log('Sitemaps found:', sitemapLines.slice(0, 20).join('\n'));

  // 2. Check OD's sitemap index
  console.log('\n=== sitemap_index.xml ===');
  const idx = await fetchText('https://www.officedepot.com/sitemap_index.xml');
  console.log('Status:', idx.status);
  console.log(idx.body.slice(0, 2000));

  // 3. Try some SFCC-style sale catalog URLs
  const testUrls = [
    'https://www.officedepot.com/catalog/search.do?sortby=plh&N=4294967260+4294965850&Nrpp=24',
    'https://www.officedepot.com/catalog/search.do?searchText=laptop&sortby=sale&Nrpp=10',
  ];
  for (const u of testUrls) {
    const r = await fetchText(u);
    const hasProducts = r.body.includes('/a/products/') || r.body.includes('sku') || r.body.includes('productId');
    console.log(`\n[${u.split('?')[1]?.slice(0,50)}] status=${r.status} hasProducts=${hasProducts}`);
    if (hasProducts) {
      const matches = r.body.match(/\/a\/products\/[^"'\s]+/g) || [];
      console.log('Sample URLs:', matches.slice(0,3).join(', '));
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });

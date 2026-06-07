require('dotenv').config();
const { newIspContext } = require('./src/services/browserEngine');

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  MACY\'S ISP PROXY TEST');
  console.log(`  ISP_PROXY_ENABLED: ${process.env.ISP_PROXY_ENABLED}`);
  console.log(`  ISP Host: ${process.env.ISP_PROXY_HOST}:${process.env.ISP_PROXY_PORT}`);
  console.log('═══════════════════════════════════════════\n');

  const TEST_URL = 'https://www.macys.com/shop/sale/women?sortby=price_low_to_high';
  let ctx;

  try {
    console.log(`▶ Loading: ${TEST_URL}`);
    ctx = await newIspContext();
    const page = await ctx.newPage();

    const t0 = Date.now();
    const response = await page.goto(TEST_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const status  = response?.status();
    const title   = await page.title().catch(() => '—');
    const html    = await page.content().catch(() => '');

    // Check for Akamai block
    const blocked = html.includes('Access Denied') || html.includes('blocked') ||
                    html.includes('Robot or human') || html.includes('cf-browser-verification') ||
                    title.toLowerCase().includes('access denied') || status === 403;

    // Count product links
    const links = await page.$$eval('a[href]', els =>
      els.map(a => a.getAttribute('href')).filter(h => h)
    ).catch(() => []);

    const productLinks = links.filter(h =>
      h.includes('/p/') || h.match(/\/\d{7,}/)
    );

    console.log(`\n  Status:    ${status}`);
    console.log(`  Title:     ${title.slice(0, 80)}`);
    console.log(`  Blocked:   ${blocked ? '⛔ YES' : '✅ NO'}`);
    console.log(`  Links:     ${links.length} total, ${productLinks.length} product links`);
    console.log(`  Time:      ${elapsed}s`);

    if (blocked) {
      const snippet = html.slice(0, 500).replace(/\s+/g, ' ');
      console.log(`\n  Block snippet: ${snippet}`);
    } else if (productLinks.length > 0) {
      console.log('\n  Sample product links:');
      productLinks.slice(0, 5).forEach(l => console.log(`    ${l}`));
    }

    await page.close().catch(() => {});
  } catch (err) {
    console.error(`\n  ERROR: ${err.message}`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    process.exit(0);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

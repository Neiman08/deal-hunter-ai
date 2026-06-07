require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { newContext } = require('../src/services/browserEngine');
const { query } = require('../src/config/database');

const DIAG_DIR = path.resolve(__dirname, '../logs/diagnostics');
const SCREENSHOT_DIR = path.join(DIAG_DIR, 'screenshots');
const HTML_DIR = path.join(DIAG_DIR, 'html');

[DIAG_DIR, SCREENSHOT_DIR, HTML_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function diagnoseUrl(store, url, identifier) {
  console.log(`\n🌐 ${store} | ${identifier}`);
  console.log(url);

  const ctx = await newContext({
    userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    viewport: { width: 1920, height: 1080 }
  });

  const page = await ctx.newPage();

  const result = {
    store,
    identifier,
    url,
    success: false,
    statusCode: null,
    finalUrl: null,
    title: null,
    loadTimeMs: null,
    hasPrice: false,
    price: null,
    error: null,
    blockType: null,
    screenshot: null,
    htmlFile: null
  };

  try {
    const start = Date.now();

    const response = await page.goto(url, {
      waitUntil: 'commit',
      timeout: 60000
    });

    await page.waitForTimeout(10000);

    result.loadTimeMs = Date.now() - start;
    result.statusCode = response?.status() || null;
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => '');

    const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 2000) || '').catch(() => '');
    const bodyLower = bodyText.toLowerCase();

    if (/captcha|robot|verify you are human/.test(bodyLower)) {
      result.blockType = 'CAPTCHA';
      result.error = 'CAPTCHA detected';
    } else if (/access denied|forbidden|403/.test(bodyLower + result.title.toLowerCase())) {
      result.blockType = 'ACCESS_DENIED';
      result.error = 'Access denied / 403';
    } else if (/no results found|0 results|try a different phrase/.test(bodyLower)) {
      result.blockType = 'NOT_FOUND';
      result.error = 'No results / invalid product';
    } else if (bodyText.length < 500) {
      result.blockType = 'EMPTY_RESPONSE';
      result.error = `Short/empty response: ${bodyText.length} chars`;
    }

    const price = await page.evaluate(() => {
      const selectors = [
        '[data-testid="customer-price"] span[aria-hidden="true"]',
        '.priceView-customer-price span[aria-hidden="true"]',
        '[class*="priceView-hero-price"] span[aria-hidden="true"]',
        '.priceView-price span',
        '[data-automation="product-price"]',
        '[data-testid="price"]',
        '.price-now',
        '.current-price',
        '.sale-price',
        '[class*="Price"]'
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent) {
          const n = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
          if (!isNaN(n) && n > 0) return n;
        }
      }

      const match = document.body.innerText.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
      if (match) return parseFloat(match[1].replace(/,/g, ''));

      return null;
    }).catch(() => null);

    if (price) {
      result.hasPrice = true;
      result.price = price;
    }

    result.success = !result.error;

    const safe = `${store}_${identifier}_${ts()}`;
    result.screenshot = path.join(SCREENSHOT_DIR, `${safe}.png`);
    result.htmlFile = path.join(HTML_DIR, `${safe}.html`);

    await page.screenshot({ path: result.screenshot, fullPage: false }).catch(() => {});
    fs.writeFileSync(result.htmlFile, await page.content());

    console.log(`Status: ${result.success ? '✅ OK' : '❌ ' + result.error}`);
    console.log(`Title: ${result.title}`);
    console.log(`Final URL: ${result.finalUrl}`);
    console.log(`Load: ${result.loadTimeMs}ms`);
    console.log(`Price: ${result.price || 'NO'}`);
    console.log(`Screenshot: ${result.screenshot}`);

  } catch (err) {
    result.error = err.message;
    result.success = false;
    console.log(`ERROR: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }

  return result;
}

async function dbCounts() {
  console.log('\n📦 PRODUCTS BY STORE');

  const r = await query(`
    SELECT s.slug, COUNT(*)::int AS total
    FROM products p
    JOIN stores s ON s.id = p.store_id
    GROUP BY s.slug
    ORDER BY s.slug
  `);

  console.table(r.rows);
}

async function main() {
  console.log('\n🔧 DEAL HUNTER AI — SCRAPER DIAGNOSTICS\n');

  await dbCounts();

  const tests = [
    ['bestbuy', 'homepage', 'https://www.bestbuy.com/'],
    ['bestbuy', 'product_new_url', 'https://www.bestbuy.com/product/apple-macbook-air-13-inch-laptop-m5-chip-with-10-core-cpu-and-8-core-gpu-16gb-memory-512gb-ssd-midnight/JJGCQLKXL7'],
    ['bestbuy', 'search_6505727', 'https://www.bestbuy.com/site/searchpage.jsp?st=6505727'],

    ['walmart', 'homepage', 'https://www.walmart.com/'],
    ['walmart', 'search_ipad', 'https://www.walmart.com/search?q=ipad'],

    ['homedepot', 'homepage', 'https://www.homedepot.com/'],
    ['homedepot', 'search_dewalt', 'https://www.homedepot.com/s/dewalt%20drill'],

    ['target', 'homepage', 'https://www.target.com/'],
    ['target', 'search_airpods', 'https://www.target.com/s?searchTerm=airpods'],

    ['lowes', 'homepage', 'https://www.lowes.com/'],
    ['lowes', 'search_drill', 'https://www.lowes.com/search?searchTerm=drill']
  ];

  const results = [];

  for (const [store, id, url] of tests) {
    const r = await diagnoseUrl(store, url, id);
    results.push(r);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  const report = path.join(DIAG_DIR, `diagnostic_report_${ts()}.json`);
  fs.writeFileSync(report, JSON.stringify(results, null, 2));

  console.log('\n════════════════════════════════════');
  console.log('📊 DIAGNOSTIC SUMMARY');
  console.log('════════════════════════════════════');

  for (const store of [...new Set(results.map(r => r.store))]) {
    const rows = results.filter(r => r.store === store);
    const working = rows.filter(r => r.success && r.hasPrice).length;
    const blocked = rows.filter(r => r.blockType).length;
    const failed = rows.filter(r => !r.success && !r.blockType).length;

    console.log(`\n${store.toUpperCase()}:`);
    console.log(`✅ Working with price: ${working}`);
    console.log(`🚫 Blocked / not found: ${blocked}`);
    console.log(`❌ Failed: ${failed}`);
  }

  console.log(`\n📄 Report: ${report}`);
  console.log(`📸 Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`📄 HTML: ${HTML_DIR}`);
  console.log('\n✅ Diagnostics complete.\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Diagnostics failed:', err);
    process.exit(1);
  });

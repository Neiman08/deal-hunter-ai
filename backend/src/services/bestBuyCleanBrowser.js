const { chromium } = require('playwright');

async function withBestBuyPage(url, fn) {
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false'
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Chicago'
  });

  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(8000);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { withBestBuyPage };

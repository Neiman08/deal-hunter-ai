/**
 * Macy's Scraper — xAPI approach
 *
 * Macy's product pages are protected by Akamai Bot Manager which blocks
 * all automated browsers regardless of stealth technique. However, the
 * internal REST API used by the Next.js frontend (xapi/digital/v1/product)
 * is accessible from a valid browser session established on the homepage.
 *
 * Strategy:
 *  1. Use playwright-extra + stealth to load macys.com (homepage passes Akamai)
 *  2. Keep the session/page alive across all product scans
 *  3. For each product, call the API via page.evaluate(fetch()) — the request
 *     carries the homepage Akamai session cookies, so it returns 200 with
 *     full product+pricing JSON without triggering bot detection.
 *
 * Product ID extraction:
 *  URL formats: /shop/product/...?ID=12345  or  /shop/product/.../ID/12345
 */

const {
  withRetry, respectDomainDelay, makeProduct,
  calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'macys';
const DOMAIN     = 'macys.com';

// ─── Session management ───────────────────────────────────────────────────────
// One long-lived browser page keeps the homepage session alive.
// All product API calls are fetch()ed from within this page context.
let _session = null;  // { browser, ctx, page }

async function getMacysSession() {
  if (_session?.page && !_session.page.isClosed()) return _session;

  if (_session?.browser) {
    await _session.browser.close().catch(() => {});
    _session = null;
  }

  logger.info('[Macys] Initializing browser session on macys.com homepage...');

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale:     'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  const page = await ctx.newPage();

  await page.goto('https://www.macys.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  const title = await page.title().catch(() => '');
  if (/access denied/i.test(title)) {
    await browser.close().catch(() => {});
    throw new Error(`[Macys] Homepage Akamai block: "${title}"`);
  }

  logger.info(`[Macys] Session ready. Homepage: "${title}"`);
  _session = { browser, ctx, page };
  return _session;
}

// ─── Product ID extraction ────────────────────────────────────────────────────
function extractProductId(url) {
  // /shop/product/.../ID/12345  or  ?ID=12345
  const m = url.match(/[/?]ID[=/](\d+)/i);
  return m?.[1] || null;
}

// ─── Price helpers ────────────────────────────────────────────────────────────
function parsePricing(pricing) {
  const tiers = pricing?.tieredPrice || [];
  const regTier  = tiers.find(t => t.values?.[0]?.type === 'regular');
  const saleTier = tiers.find(t => t.values?.[0]?.type === 'discount');

  const regularPrice  = regTier?.values?.[0]?.value  ?? null;
  const salePrice     = saleTier?.values?.[0]?.value ?? null;
  const discountPct   = saleTier?.values?.[0]?.percentOff?.[0] ?? null;
  const currentPrice  = salePrice ?? regularPrice;

  const priceTypeText = (pricing?.priceType?.text || '').toLowerCase();
  const clearance = priceTypeText.includes('clearance') || priceTypeText.includes('last act');

  return { currentPrice, regularPrice, discountPct, clearance };
}

// ─── Single product scraper ───────────────────────────────────────────────────
async function scrapeMacysProduct(url) {
  logger.info(`[Macys] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  const productId = extractProductId(url);
  if (!productId) throw new Error(`[Macys] Cannot extract product ID from: ${url}`);

  return withRetry(async () => {
    const session = await getMacysSession();

    const apiPath = `/xapi/digital/v1/product/${productId}?clientId=PROS&currencyCode=USD&_regionCode=US`;

    const result = await session.page.evaluate(async (path) => {
      const resp = await fetch(path, {
        headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      });
      return { status: resp.status, data: resp.ok ? await resp.json().catch(() => null) : null };
    }, apiPath);

    if (!result.data?.product?.[0]) {
      // Session might have expired — force a refresh on next retry
      if (result.status === 403 || result.status === 401) {
        _session = null;
        throw new Error(`[Macys] API session expired (${result.status}) — will reinitialize`);
      }
      throw new Error(`[Macys] API ${result.status} for product ${productId}`);
    }

    const p       = result.data.product[0];
    const pricing = p.pricing?.price;
    const { currentPrice, regularPrice, discountPct, clearance } = parsePricing(pricing);

    if (!currentPrice) throw new Error(`[Macys] No price in API response for ${productId}`);

    const imageFile = p.imagery?.images?.[0]?.filePath;
    const imageUrl  = imageFile
      ? `https://slimages.macysassets.com/is/image/MCY/products/${imageFile}?wid=500`
      : null;

    logger.info(
      `[Macys] ✅ API | "${p.detail?.name}" | $${currentPrice}` +
      (regularPrice ? ` (reg $${regularPrice})` : '') +
      (discountPct  ? ` | ${discountPct}% off`  : '') +
      (clearance    ? ' | CLEARANCE'             : '')
    );

    return makeProduct({
      name:         p.detail?.name,
      brand:        p.detail?.brand?.name,
      sku:          String(p.identifier?.productId || productId),
      currentPrice,
      regularPrice: regularPrice || null,
      discountPercent: discountPct || calcDiscount(currentPrice, regularPrice),
      inStock:      p.availability?.available ?? true,
      imageUrl,
      productUrl:   url,
      clearance,
      pageText:     clearance ? 'clearance' : '',
      source:       'macys_api',
    });
  }, { maxAttempts: 3, baseDelay: 2500, label: 'Macys' });
}

// ─── Batch scan ───────────────────────────────────────────────────────────────
async function scanMacysDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info("🛍️  MACY'S API SCAN");
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'macys'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[Macys] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeMacysProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[Macys] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[Macys] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeMacysProduct, scanMacysDeals };

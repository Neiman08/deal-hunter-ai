/**
 * Target Playwright Scraper
 *
 * Extraction order:
 *  1. LD+JSON (primary — always present in SSR, enriched with regularPrice from __NEXT_DATA__)
 *  2. window.__PRELOADED_QUERIES__ (Apollo cache fallback)
 *  3. DOM selectors (last resort)
 */

const { withPage }      = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'target';
const DOMAIN     = 'target.com';

const PRICE_SELECTORS = [
  '[data-test="product-price"]',
  '[class*="Price__StyledCurrentPrice"]',
  '[class*="h-text-bs"]',
  'div[class*="style__PriceFontSize"]',
  '[data-qa="product-price"]',
];

const STRIKE_SELECTORS = [
  '[data-test="product-regular-price"]',
  '[class*="Price__StyledCrossedOutPrice"]',
  '[class*="sr-only"] + span',
];

async function scrapeTargetProduct(url) {
  logger.info(`[Target] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withPage(url, async (page) => {

    // Brief wait for SSR content — avoids 15s selector penalty
    await page.waitForTimeout(1500).catch(() => {});

    // ── M1: LD+JSON + embedded scripts for regularPrice (primary) ─────────
    const ldResult = await extractFromPageJSON(page, () => {
      try {
        // Step 1: find LD+JSON with price
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        let ldData = null;
        for (const s of scripts) {
          let d;
          try { d = JSON.parse(s.textContent); } catch { continue; }
          const item = Array.isArray(d) ? d[0] : d;
          if (item?.offers?.price) {
            ldData = {
              name:     item.name,
              brand:    item.brand?.name,
              price:    parseFloat(item.offers.price),
              inStock:  item.offers.availability?.includes('InStock') !== false,
              imageUrl: typeof item.image === 'string' ? item.image : item.image?.[0],
              sku:      item.sku || item.mpn || null,
            };
            break;
          }
        }
        if (!ldData) return null;

        // Step 2: enrich with regularPrice from __NEXT_DATA__ (Next.js)
        let regularPrice = null;
        let clearance = false;
        try {
          const nd = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
          const pdp = nd?.props?.pageProps;
          const prod = pdp?.product || pdp?.productData?.data?.product
                    || pdp?.initialData?.data?.product;
          if (prod?.price) {
            regularPrice = parseFloat(prod.price.regular_retail || prod.price.reg_retail || 0) || null;
            clearance = !!(prod.price.is_clearance);
          }
        } catch {}

        // Step 3: fall back to Apollo cache for regularPrice
        if (!regularPrice) {
          try {
            const q = window?.__PRELOADED_QUERIES__?.queries;
            if (q) {
              for (const [, data] of Object.entries(q)) {
                const pr = data?.data?.product?.price;
                if (pr?.regular_retail) {
                  regularPrice = parseFloat(pr.regular_retail);
                  clearance = clearance || !!(pr.is_clearance);
                  break;
                }
              }
            }
          } catch {}
        }

        return { ...ldData, regularPrice, clearance };
      } catch { return null; }
    }, 'LD+JSON');

    if (ldResult?.price) {
      const regLabel = ldResult.regularPrice ? ` / reg $${ldResult.regularPrice}` : '';
      logger.info(`[Target] ✅ LD+JSON | "${ldResult.name}" | $${ldResult.price}${regLabel}`);
      return makeProduct({
        name:            ldResult.name,
        brand:           ldResult.brand,
        currentPrice:    ldResult.price,
        regularPrice:    ldResult.regularPrice || ldResult.price * 1.2,
        discountPercent: calcDiscount(ldResult.price, ldResult.regularPrice),
        inStock:         ldResult.inStock,
        imageUrl:        ldResult.imageUrl,
        productUrl:      url,
        clearance:       ldResult.clearance,
        pageText:        ldResult.clearance ? 'clearance' : '',
        source:          'target_playwright_ldjson',
      });
    }

    // ── M2: Apollo cache (__PRELOADED_QUERIES__) ──────────────────────────
    const apollo = await extractFromPageJSON(page, () => {
      try {
        const q = window?.__PRELOADED_QUERIES__?.queries;
        if (!q) return null;
        for (const [, data] of Object.entries(q)) {
          const item = data?.data?.product;
          if (item?.item?.enrichment?.images) {
            return {
              name:     item.item?.product_description?.title,
              brand:    item.item?.product_description?.bullet_descriptions?.[0],
              price:    item.price?.current_retail,
              reg:      item.price?.regular_retail,
              inStock:  item.item?.fulfillment?.is_out_of_stock === false,
              imageUrl: item.item?.enrichment?.images?.primary_image_url,
              clearance: item.price?.is_clearance,
            };
          }
        }
        return null;
      } catch { return null; }
    }, '__PRELOADED_QUERIES__');

    if (apollo?.price) {
      logger.info(`[Target] ✅ Apollo | "${apollo.name}" | $${apollo.price}`);
      return makeProduct({
        name:            apollo.name,
        brand:           apollo.brand,
        currentPrice:    apollo.price,
        regularPrice:    apollo.reg || apollo.price * 1.2,
        discountPercent: calcDiscount(apollo.price, apollo.reg),
        inStock:         apollo.inStock,
        imageUrl:        apollo.imageUrl,
        productUrl:      url,
        clearance:       apollo.clearance,
        pageText:        apollo.clearance ? 'clearance' : '',
        source:          'target_playwright_apollo',
      });
    }

    // ── M3: DOM selectors ─────────────────────────────────────────────────
    try {
      await page.waitForSelector('[data-test="product-price"], [class*="Price"], h1', { timeout: 5000 });
    } catch {}

    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'target price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price on Target page. Title: "${title}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'target regular');
    const name         = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const imageUrl     = await page.$eval('[data-test="heroImageContainer"] img, [data-test="product-image"]', el => el.src).catch(() => null);
    const inStock      = await page.$('button[data-test="shippingATCButton"], button[data-test="orderPickupButton"]').then(Boolean).catch(() => true);
    const clearance    = await page.$('[data-test="clearancePill"], [class*="clearance"]').then(Boolean).catch(() => false);
    const pageText     = await page.$eval('body', el => el.innerText?.slice(0, 1000)).catch(() => '');

    logger.info(`[Target] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name,
      currentPrice,
      regularPrice:    regularPrice || currentPrice * 1.2,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url, clearance,
      pageText: clearance ? 'clearance ' + pageText : pageText,
      source: 'target_playwright_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 3, baseDelay: 2500, label: `Target` });
}

async function scanTargetDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🎯 TARGET PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'target'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[Target] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeTargetProduct(p.product_url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[Target] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[Target] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeTargetProduct, scanTargetDeals };

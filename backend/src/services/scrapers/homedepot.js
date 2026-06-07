/**
 * Home Depot Playwright Scraper
 *
 * Home Depot uses React/Next.js. Pages hydrate quickly.
 * Their federation GraphQL is public and reliable — we call it directly
 * from the browser context to bypass CSP restrictions.
 *
 * Extraction order:
 *  1. federation-gateway GraphQL (called from page context — avoids CORS)
 *  2. __NEXT_DATA__ in page
 *  3. DOM selectors
 */

const { withPage }      = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'home-depot';
const DOMAIN     = 'homedepot.com';
const DEFAULT_STORE_ID = process.env.HD_STORE_ID || '6906';

const PRICE_SELECTORS = [
  '[data-component="price"] span[data-testid]',
  '.price-format__large',
  '[class*="price-format__large"]',
  'div[data-testid="price-format"]',
  '.price__dollars',
  '[data-automationid="price"]',
];

const STRIKE_SELECTORS = [
  '.price-format__was',
  '[class*="price-format__was"]',
  '[data-testid="was-price"]',
  '.was-price',
];

function buildUrl(sku) {
  return `https://www.homedepot.com/p/${sku}`;
}

async function scrapeHomeDepotProduct(skuOrUrl, storeId = DEFAULT_STORE_ID) {
  const url = skuOrUrl.startsWith('http') ? skuOrUrl : buildUrl(skuOrUrl);
  const sku  = url.split('/').pop();
  logger.info(`[HomeDepot] Scraping ${url} (storeId: ${storeId})`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withPage(url, async (page) => {

    // Wait for price or main content
    try {
      await page.waitForSelector('[data-component="price"], .price-format__large', { timeout: 15000 });
    } catch {
      logger.warn('[HomeDepot] Price selector timeout — trying fallback');
    }

    // ── M1: Call GraphQL directly from page context ───────────────────────
    const gql = await page.evaluate(async ({ sku, storeId }) => {
      try {
        const res = await fetch(
          'https://www.homedepot.com/federation-gateway/graphql?opname=productClientOnlyProduct',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              operationName: 'productClientOnlyProduct',
              variables: { itemId: sku, storeId: String(storeId) },
              query: `query productClientOnlyProduct($itemId:String!,$storeId:String){
                product(itemId:$itemId){
                  itemId brand
                  identifiers{productLabel modelNumber brandName}
                  pricing(storeId:$storeId){value original specialBuyPrice}
                  fulfillment(storeId:$storeId){
                    backordered fulfillableQuantity
                    fulfillmentOptions{type fulfillable quantityAvailable}
                  }
                  media{images{url}}
                  taxonomy{breadCrumbs{label}}
                }}`,
            }),
          }
        );
        const json = await res.json();
        return json?.data?.product || null;
      } catch { return null; }
    }, { sku, storeId });

    if (gql?.pricing?.value) {
      const price   = parseFloat(gql.pricing.value);
      const regPrice = gql.pricing.original ? parseFloat(gql.pricing.original) : price * 1.4;
      const storeOpt = gql.fulfillment?.fulfillmentOptions?.find(o => o.type === 'STORE');
      logger.info(`[HomeDepot] ✅ GraphQL | "${gql.identifiers?.productLabel}" | $${price}`);
      return makeProduct({
        name:    gql.identifiers?.productLabel,
        brand:   gql.identifiers?.brandName || gql.brand,
        sku:     gql.itemId,
        currentPrice:    price,
        regularPrice:    regPrice,
        discountPercent: calcDiscount(price, regPrice),
        inStock:  !gql.fulfillment?.backordered && (storeOpt?.fulfillable ?? true),
        stockQty: storeOpt?.quantityAvailable ?? gql.fulfillment?.fulfillableQuantity,
        imageUrl: gql.media?.images?.[0]?.url,
        productUrl: url,
        source: 'homedepot_playwright_graphql',
      });
    }

    // ── M2: __NEXT_DATA__ ─────────────────────────────────────────────────
    const next = await extractFromPageJSON(page, () => {
      try {
        const j = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
        const p = j?.props?.pageProps?.product || j?.props?.pageProps?.initialData?.product;
        if (!p) return null;
        return {
          name:  p.identifiers?.productLabel,
          brand: p.brand,
          price: p.pricing?.value,
          reg:   p.pricing?.original,
          inStock: !p.fulfillment?.backordered,
          imageUrl: p.media?.images?.[0]?.url,
        };
      } catch { return null; }
    }, '__NEXT_DATA__');

    if (next?.price) {
      logger.info(`[HomeDepot] ✅ NEXT_DATA | "${next.name}" | $${next.price}`);
      return makeProduct({
        name: next.name, brand: next.brand,
        currentPrice: next.price,
        regularPrice: next.reg || next.price * 1.4,
        discountPercent: calcDiscount(next.price, next.reg),
        inStock: next.inStock, imageUrl: next.imageUrl, productUrl: url,
        source: 'homedepot_playwright_next',
      });
    }

    // ── M3: DOM selectors ─────────────────────────────────────────────────
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'homedepot price');
    if (!currentPrice) {
      const title = await page.title().catch(() => '');
      throw new Error(`No price on HD page. Title: "${title}"`);
    }

    const regularPrice = await extractPrice(page, STRIKE_SELECTORS, 'homedepot was');
    const name         = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const imageUrl     = await page.$eval('.mediagallery__mainimage img, .primary-image', el => el.src).catch(() => null);
    const inStock      = await page.$('button[data-component="ButtonSecondary"]').then(Boolean).catch(() => true);
    const pageText     = await page.$eval('body', el => el.innerText?.slice(0, 1000)).catch(() => '');

    logger.info(`[HomeDepot] ✅ DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, currentPrice,
      regularPrice: regularPrice || null,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl: url, pageText,
      source: 'homedepot_playwright_dom',
    });

  }, { waitUntil: 'domcontentloaded' }),
  { maxAttempts: 3, baseDelay: 2500, label: `HomeDepot` });
}

async function scanHomeDepotDeals() {
  logger.info('\n' + '═'.repeat(55));
  logger.info('🔨 HOME DEPOT PLAYWRIGHT SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'home-depot'
      AND (p.product_url IS NOT NULL OR p.sku IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM prices pr WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '25 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[HomeDepot] ${rows.rows.length} products queued`);
  const stats = { scanned: 0, deals: 0, errors: 0 };

  for (const p of rows.rows) {
    const url = p.product_url || (p.sku ? buildUrl(p.sku) : null);
    if (!url) continue;
    try {
      const scraped = await scrapeHomeDepotProduct(url);
      if (!scraped?.currentPrice) { stats.errors++; continue; }
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 15) stats.deals++;
    } catch (err) {
      logger.error(`[HomeDepot] FAIL "${p.name}": ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`[HomeDepot] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeHomeDepotProduct, scanHomeDepotDeals, buildUrl };

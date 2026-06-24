/**
 * Harbor Freight Scraper — ISP Playwright + Apollo State
 *
 * Harbor Freight is a Magento 2 PWA (React + GraphQL via api.harborfreight.com).
 * Product pages embed full product data in window.__APOLLO_STATE__.
 * PerimeterX protects direct HTTP — requires Playwright + ISP proxy.
 *
 * Extraction order:
 *  1. window.__APOLLO_STATE__ — most complete, has sale_price vs regular_price
 *  2. JSON-LD Product schema — standard fallback
 *  3. DOM price selectors — last resort
 */

const { withIspPage }    = require('../browserEngine');
const { withRetry, respectDomainDelay, makeProduct, extractPrice, parseTextPrice, calcDiscount, saveProductData } = require('../scraperBase');
const { query }          = require('../../config/database');
const logger             = require('../../utils/logger');

const STORE_SLUG = 'harbor-freight';
const DOMAIN     = 'harborfreight.com';

// CSS selectors for price when Apollo state isn't available
const PRICE_SELECTORS = [
  '[data-testid="product-price"] [class*="price__"]',
  '[class*="ProductPrice"] [class*="price"]',
  '.product-price [class*="price"]',
  '[itemprop="price"]',
  '[data-price-type="finalPrice"] [data-price-amount]',
];
const STRIKE_SELECTORS = [
  '[class*="ProductPrice"] [class*="old-price"]',
  '.product-price [class*="old-price"]',
  '[data-price-type="oldPrice"] [data-price-amount]',
  '[class*="regular-price"]',
];

function extractSkuFromUrl(url) {
  const m = url.match(/-(\d{4,6})\.html/);
  return m ? m[1] : null;
}

function slugToName(url) {
  try {
    const path = new URL(url).pathname;
    const seg  = path.split('/').pop().replace(/\.html$/, '');
    const sku  = extractSkuFromUrl(url);
    const slug = sku ? seg.replace(new RegExp(`-${sku}$`), '') : seg;
    return slug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
      .slice(0, 200);
  } catch {
    return null;
  }
}

function parseApolloState(apolloJson, sku) {
  try {
    const state = JSON.parse(apolloJson);
    // Find the Product entry for this SKU
    const productKey = Object.keys(state).find(k =>
      k.startsWith('SimpleProduct:') || k.startsWith('ConfigurableProduct:') ||
      (k.includes('Product') && state[k]?.sku === sku)
    );
    if (!productKey) return null;
    const p = state[productKey];

    const finalPrice   = p?.price_range?.minimum_price?.final_price?.value
                      ?? p?.price_range?.minimum_price?.regular_price?.value
                      ?? p?.sale_price
                      ?? null;
    const regularPrice = p?.price_range?.minimum_price?.regular_price?.value
                      ?? p?.price_range?.maximum_price?.regular_price?.value
                      ?? null;
    const image = p?.image?.url || p?.thumbnail?.url || null;
    const name  = p?.name || null;

    if (!finalPrice) return null;
    return { name, sku: p.sku || sku, finalPrice, regularPrice, image };
  } catch {
    return null;
  }
}

async function scrapeHarborFreightProduct(urlOrSku) {
  const url = urlOrSku.startsWith('http')
    ? urlOrSku
    : `https://www.harborfreight.com/catalog/product/view/id/${urlOrSku}`;

  const sku = extractSkuFromUrl(url) || (urlOrSku.match(/^\d+$/) ? urlOrSku : null);
  logger.info(`[HarborFreight] Scraping ${url}`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withIspPage(url, async (page) => {
    try {
    // Wait for price or content to load
    await page.waitForTimeout(2000);
    try {
      await page.waitForSelector(PRICE_SELECTORS[0] + ', [class*="price"]', { timeout: 12000 });
    } catch {
      logger.warn('[HarborFreight] Price selector timeout — proceeding with state extraction');
    }

    const pageUrl  = page.url();
    const pageTitle = await page.title().catch(() => '');

    // Check for blocks
    if (/access denied|captcha|blocked/i.test(pageTitle)) {
      throw new Error(`Blocked: ${pageTitle}`);
    }

    // 1. Try Apollo State
    const apolloJson = await page.evaluate(() => {
      const state = window.__APOLLO_STATE__;
      return state ? JSON.stringify(state) : null;
    }).catch(() => null);

    if (apolloJson && sku) {
      const parsed = parseApolloState(apolloJson, sku);
      if (parsed?.finalPrice) {
        const discount = calcDiscount(parsed.finalPrice, parsed.regularPrice);
        logger.info(`[HarborFreight] Apollo: ${parsed.name} $${parsed.finalPrice} (was $${parsed.regularPrice}) ${discount}%`);
        return makeProduct({
          name:            parsed.name || slugToName(url),
          sku:             parsed.sku || sku,
          brand:           'Harbor Freight',
          currentPrice:    parsed.finalPrice,
          regularPrice:    parsed.regularPrice,
          discountPercent: discount,
          imageUrl:        parsed.image,
          productUrl:      pageUrl || url,
          inStock:         true,
          store:           STORE_SLUG,
          clearance:       /clearance/i.test(url),
        });
      }
    }

    // 2. Try JSON-LD Product schema
    const jsonLd = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const d = JSON.parse(s.textContent);
          if (d['@type'] === 'Product') return d;
          if (Array.isArray(d['@graph'])) {
            const p = d['@graph'].find(n => n['@type'] === 'Product');
            if (p) return p;
          }
        } catch {}
      }
      return null;
    }).catch(() => null);

    if (jsonLd) {
      const offers  = jsonLd.offers || {};
      // offers.price is a string/number — use parseTextPrice, NOT extractPrice(page, selectors)
      const current = parseTextPrice(String(offers.price ?? offers.lowPrice ?? ''));
      const regular = parseTextPrice(String(offers.highPrice ?? ''));
      if (current) {
        const discount = calcDiscount(current, regular);
        return makeProduct({
          name:            jsonLd.name || slugToName(url),
          sku:             jsonLd.sku || sku,
          brand:           jsonLd.brand?.name || 'Harbor Freight',
          currentPrice:    current,
          regularPrice:    regular || null,
          discountPercent: discount,
          imageUrl:        Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image,
          productUrl:      pageUrl || url,
          inStock:         offers.availability !== 'https://schema.org/OutOfStock',
          store:           STORE_SLUG,
          clearance:       /clearance/i.test(url),
        });
      }
    }

    // 3. DOM fallback — use await extractPrice(page, selectors) not parseTextPrice
    const current = await extractPrice(page, PRICE_SELECTORS, 'hf price').catch(() => null);
    if (!current) {
      logger.warn(`[HarborFreight] No price found for ${url}`);
      return null;
    }

    const regular  = await extractPrice(page, STRIKE_SELECTORS, 'hf was').catch(() => null);
    const discount = calcDiscount(current, regular);
    const name     = await page.evaluate(() =>
      document.querySelector('h1, [class*="product-name"], [itemprop="name"]')?.textContent?.trim()
    ).catch(() => null);
    const image    = await page.evaluate(() => {
      const img = document.querySelector('[class*="product-image"] img, [itemprop="image"]');
      return img?.src || img?.getAttribute('data-src') || null;
    }).catch(() => null);

    return makeProduct({
      name:            name || slugToName(url),
      sku:             sku,
      brand:           'Harbor Freight',
      currentPrice:    current,
      regularPrice:    regular || null,
      discountPercent: discount,
      imageUrl:        image,
      productUrl:      pageUrl || url,
      inStock:         true,
      store:           STORE_SLUG,
      clearance:       /clearance/i.test(url),
    });
    } catch (err) {
      logger.error(`[HarborFreight] Scrape error for ${url}: ${err.message}`);
      return null;
    }
  }), { retries: 2, delay: 3000 });
}

async function scanHarborFreightDeals() {
  const { query: q } = require('../../config/database');
  const { saveProductData: spd } = require('../scraperBase');
  logger.info('[HarborFreight] Scan job started — delegating to discovery engine');
  return { skipped: true, reason: 'use_discovery_engine' };
}

module.exports = { scrapeHarborFreightProduct, scanHarborFreightDeals };

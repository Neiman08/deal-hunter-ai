/**
 * Wayfair Scraper — ISP Playwright + JSON-LD / Server State
 *
 * Wayfair uses PerimeterX — requires Playwright + ISP proxy.
 * Product pages include JSON-LD Product schema and og: meta tags.
 *
 * Product URL pattern: wayfair.com/{category}/pdp/{name}-{SKU}.html
 * SKU is the alphanumeric code at the end: W001234, CPG12038, etc.
 *
 * Extraction order:
 *  1. JSON-LD Product schema (most reliable on SSR pages)
 *  2. og:price meta tags (fast fallback)
 *  3. window.__SERVER_SIDE_RENDERING_STATE__ or window.headless_config
 *  4. DOM price selectors
 */

const { withIspPage }    = require('../browserEngine');
const { withRetry, respectDomainDelay, makeProduct, extractPrice, calcDiscount } = require('../scraperBase');
const logger             = require('../../utils/logger');

const STORE_SLUG = 'wayfair';
const DOMAIN     = 'wayfair.com';

const PRICE_SELECTORS = [
  '[data-testid="sale-price"]',
  '[data-testid="price"]',
  '[class*="ProductPrice"] [class*="price"]',
  '[class*="price-sale"]',
  '[class*="PriceBlock"] [class*="price"]',
  'span[class*="BasePriceBlock"]',
];
const STRIKE_SELECTORS = [
  '[data-testid="was-price"]',
  '[class*="price-was"]',
  '[class*="ProductPrice"] [class*="was"]',
  'del[class*="price"]',
  's[class*="price"]',
];

function extractSkuFromUrl(url) {
  // Pattern: ends with -{SKU}.html where SKU is alphanumeric (W0012, CPG123, etc.)
  const m = url.match(/-([A-Z]{1,5}\d+|[A-Z]\d{6,})\.html/i);
  return m ? m[1].toUpperCase() : null;
}

function slugToName(url) {
  try {
    const path = new URL(url).pathname;
    // Extract the PDP slug: .../pdp/{name}-{SKU}.html
    const seg  = path.split('/pdp/').pop()?.split('.html')[0] || path.split('/').pop().replace(/\.html$/, '');
    const sku  = extractSkuFromUrl(url);
    const slug = sku ? seg.replace(new RegExp(`-${sku}$`, 'i'), '') : seg;
    return slug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
      .slice(0, 200);
  } catch {
    return null;
  }
}

function extractCategoryFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const pdpIdx = parts.indexOf('pdp');
    if (pdpIdx > 0) return parts[pdpIdx - 1]; // e.g. "lighting", "rugs", "furniture"
    return parts[0] || null;
  } catch {
    return null;
  }
}

async function scrapeWayfairProduct(urlOrSku) {
  const url = urlOrSku.startsWith('http') ? urlOrSku : null;
  if (!url) {
    logger.warn(`[Wayfair] Cannot scrape without full URL: ${urlOrSku}`);
    return null;
  }

  const sku = extractSkuFromUrl(url);
  logger.info(`[Wayfair] Scraping ${url} (sku=${sku})`);
  await respectDomainDelay(DOMAIN);

  return withRetry(async () => withIspPage(url, async (page) => {
    await page.waitForTimeout(2000);
    try {
      await page.waitForSelector(PRICE_SELECTORS.join(', '), { timeout: 15000 });
    } catch {
      logger.warn('[Wayfair] Price selector timeout — attempting state extraction');
    }

    const pageUrl   = page.url();
    const pageTitle = await page.title().catch(() => '');

    if (/access denied|captcha|verify.*human/i.test(pageTitle)) {
      throw new Error(`Blocked: ${pageTitle}`);
    }

    // 1. JSON-LD Product schema
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
      const offers  = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : (jsonLd.offers || {});
      const current = extractPrice(offers.price ?? offers.lowPrice);
      const regular = extractPrice(offers.highPrice);
      if (current) {
        const discount = calcDiscount(current, regular);
        const img = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
        logger.info(`[Wayfair] JSON-LD: ${jsonLd.name} $${current} (was $${regular}) ${discount}%`);
        return makeProduct({
          name:            jsonLd.name || slugToName(url),
          sku:             sku || jsonLd.sku,
          brand:           jsonLd.brand?.name || null,
          currentPrice:    current,
          regularPrice:    regular,
          discountPercent: discount,
          imageUrl:        typeof img === 'string' ? img : (img?.url || null),
          productUrl:      pageUrl || url,
          inStock:         offers.availability !== 'https://schema.org/OutOfStock',
          store:           STORE_SLUG,
          clearance:       false,
          categorySlug:    'home',
        });
      }
    }

    // 2. og: meta tags
    const ogData = await page.evaluate(() => {
      const get = (name) => document.querySelector(`meta[property="${name}"]`)?.getAttribute('content')
                         || document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
      return {
        price:     get('og:price:amount') || get('product:price:amount'),
        currency:  get('og:price:currency') || 'USD',
        title:     get('og:title'),
        image:     get('og:image'),
      };
    }).catch(() => ({}));

    if (ogData.price) {
      const current = extractPrice(ogData.price);
      if (current) {
        // og: doesn't have was-price — try DOM for strikethrough
        const strikeText = await page.evaluate((sels) => {
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el) return el.textContent.trim();
          }
          return null;
        }, STRIKE_SELECTORS).catch(() => null);
        const regular  = extractPrice(strikeText);
        const discount = calcDiscount(current, regular);
        logger.info(`[Wayfair] og:price: ${ogData.title} $${current}`);
        return makeProduct({
          name:            ogData.title || slugToName(url),
          sku,
          brand:           null,
          currentPrice:    current,
          regularPrice:    regular,
          discountPercent: discount,
          imageUrl:        ogData.image,
          productUrl:      pageUrl || url,
          inStock:         true,
          store:           STORE_SLUG,
          clearance:       false,
          categorySlug:    'home',
        });
      }
    }

    // 3. DOM selectors fallback
    const priceText = await page.evaluate((sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return el.textContent.trim();
      }
      return null;
    }, PRICE_SELECTORS).catch(() => null);

    const current = extractPrice(priceText);
    if (!current) {
      logger.warn(`[Wayfair] No price found for ${url}`);
      return null;
    }

    const strikeText = await page.evaluate((sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return el.textContent.trim();
      }
      return null;
    }, STRIKE_SELECTORS).catch(() => null);

    const regular  = extractPrice(strikeText);
    const discount = calcDiscount(current, regular);
    const name     = await page.evaluate(() =>
      document.querySelector('h1, [class*="ProductTitle"], [itemprop="name"]')?.textContent?.trim()
    ).catch(() => null);
    const image    = await page.evaluate(() => {
      const img = document.querySelector('[class*="ProductImage"] img, [itemprop="image"], picture img');
      return img?.src || img?.getAttribute('data-src') || null;
    }).catch(() => null);

    return makeProduct({
      name:            name || slugToName(url),
      sku,
      brand:           null,
      currentPrice:    current,
      regularPrice:    regular,
      discountPercent: discount,
      imageUrl:        image,
      productUrl:      pageUrl || url,
      inStock:         true,
      store:           STORE_SLUG,
      clearance:       false,
      categorySlug:    'home',
    });
  }), { retries: 2, delay: 4000 });
}

async function scanWayfairDeals() {
  logger.info('[Wayfair] Scan job started — delegating to discovery engine');
  return { skipped: true, reason: 'use_discovery_engine' };
}

module.exports = { scrapeWayfairProduct, scanWayfairDeals };

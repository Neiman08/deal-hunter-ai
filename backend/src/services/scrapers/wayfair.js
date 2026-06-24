/**
 * Wayfair Scraper — ISP Playwright + JSON-LD / Server State
 *
 * Wayfair uses PerimeterX — requires Playwright + ISP proxy.
 * Product pages include JSON-LD Product schema and og: meta tags.
 *
 * Price extraction:
 *  - String values (JSON-LD, og:meta): use parseTextPrice(string)
 *  - DOM page selectors:               use await extractPrice(page, selectors)
 */

const { withIspPage }    = require('../browserEngine');
const { withRetry, respectDomainDelay, makeProduct, extractPrice, parseTextPrice, calcDiscount } = require('../scraperBase');
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
  const m = url.match(/-([A-Z]{1,5}\d+|[A-Z]\d{6,})\.html/i);
  return m ? m[1].toUpperCase() : null;
}

function slugToName(url) {
  try {
    const path = new URL(url).pathname;
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
    try {
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

      // 1. JSON-LD Product schema — use parseTextPrice for string values
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
        const current = parseTextPrice(String(offers.price ?? offers.lowPrice ?? ''));
        const regular = parseTextPrice(String(offers.highPrice ?? ''));
        if (current) {
          const discount = calcDiscount(current, regular);
          const img = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
          logger.info(`[Wayfair] JSON-LD: ${jsonLd.name} $${current} (was $${regular}) ${discount}%`);
          return makeProduct({
            name:            jsonLd.name || slugToName(url),
            sku:             sku || jsonLd.sku,
            brand:           jsonLd.brand?.name || null,
            currentPrice:    current,
            regularPrice:    regular || null,
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

      // 2. og: meta tags — use parseTextPrice for string values
      const ogData = await page.evaluate(() => {
        const get = (name) => document.querySelector(`meta[property="${name}"]`)?.getAttribute('content')
                           || document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
        return {
          price:    get('og:price:amount') || get('product:price:amount'),
          title:    get('og:title'),
          image:    get('og:image'),
        };
      }).catch(() => ({}));

      if (ogData.price) {
        const current = parseTextPrice(ogData.price);
        if (current) {
          // og: doesn't have was-price — use DOM extractPrice for strikethrough
          const regular  = await extractPrice(page, STRIKE_SELECTORS, 'wayfair was').catch(() => null);
          const discount = calcDiscount(current, regular);
          logger.info(`[Wayfair] og:price: ${ogData.title} $${current}`);
          return makeProduct({
            name:            ogData.title || slugToName(url),
            sku,
            brand:           null,
            currentPrice:    current,
            regularPrice:    regular || null,
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

      // 3. DOM selectors fallback — use await extractPrice(page, selectors)
      const current = await extractPrice(page, PRICE_SELECTORS, 'wayfair price').catch(() => null);
      if (!current) {
        logger.warn(`[Wayfair] No price found for ${url}`);
        return null;
      }

      const regular  = await extractPrice(page, STRIKE_SELECTORS, 'wayfair was').catch(() => null);
      const discount = calcDiscount(current, regular);

      const name = await page.evaluate(() =>
        document.querySelector('h1, [class*="ProductTitle"], [itemprop="name"]')?.textContent?.trim()
      ).catch(() => null);
      const image = await page.evaluate(() => {
        const img = document.querySelector('[class*="ProductImage"] img, [itemprop="image"], picture img');
        return img?.src || img?.getAttribute('data-src') || null;
      }).catch(() => null);

      return makeProduct({
        name:            name || slugToName(url),
        sku,
        brand:           null,
        currentPrice:    current,
        regularPrice:    regular || null,
        discountPercent: discount,
        imageUrl:        image,
        productUrl:      pageUrl || url,
        inStock:         true,
        store:           STORE_SLUG,
        clearance:       false,
        categorySlug:    'home',
      });
    } catch (err) {
      logger.error(`[Wayfair] Scrape error for ${url}: ${err.message}`);
      return null;
    }
  }), { retries: 2, delay: 4000 });
}

async function scanWayfairDeals() {
  logger.info('[Wayfair] Scan job started — delegating to discovery engine');
  return { skipped: true, reason: 'use_discovery_engine' };
}

module.exports = { scrapeWayfairProduct, scanWayfairDeals };

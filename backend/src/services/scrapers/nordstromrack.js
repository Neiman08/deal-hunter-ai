/**
 * Nordstrom Rack product scraper
 * Uses residential proxy context. Falls back gracefully if blocked.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');

const STORE_SLUG = 'nordstrom-rack';

async function scrapeNordstromRackProduct(url) {
  const getCtx = () => process.env.PROXY_ENABLED === 'true' ? newContext() : newBestBuyContext();
  const ctx  = await getCtx();
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const data = await page.evaluate(() => {
      // LD+JSON
      const lds = document.querySelectorAll('script[type="application/ld+json"]');
      for (const el of lds) {
        try {
          const parsed = JSON.parse(el.textContent);
          const item = Array.isArray(parsed) ? parsed[0] : parsed;
          if (item?.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            return {
              name:         item.name || '',
              brand:        item.brand?.name || '',
              sku:          item.sku || item.mpn || '',
              currentPrice: parseFloat(offer?.price) || null,
              regularPrice: null,
              inStock:      offer?.availability?.includes('InStock') ?? false,
              imageUrl:     Array.isArray(item.image) ? item.image[0] : item.image,
              source:       'ld+json',
            };
          }
        } catch {}
      }

      // DOM fallback — Nordstrom Rack React SPA
      const name = document.querySelector('h1[data-testid="product-title"], h1[class*="product-name"], h1')?.textContent?.trim();
      const priceEl = document.querySelector('[data-testid="sale-price"], [class*="sale-price"], [class*="current-price"]');
      const regPriceEl = document.querySelector('[data-testid="compare-price"], [class*="compare-price"], [class*="was-price"]');
      const imgEl = document.querySelector('[data-testid="product-image"] img, .product-photo img, [class*="hero-image"] img');
      const stockEl = document.querySelector('[data-testid="availability"], [class*="availability"]');

      const priceText = priceEl?.textContent?.trim();
      const regText   = regPriceEl?.textContent?.trim();
      const inStock   = !stockEl?.textContent?.toLowerCase().includes('sold out');

      return {
        name,
        brand: '',
        sku: '',
        currentPrice: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) || null : null,
        regularPrice: regText   ? parseFloat(regText.replace(/[^0-9.]/g, ''))   || null : null,
        inStock,
        imageUrl: imgEl?.src || imgEl?.getAttribute('data-src') || null,
        source: 'dom',
      };
    });

    return { ...data, productUrl: url, storeSlug: STORE_SLUG };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

async function scanNordstromRackDeals() {
  const { runNordstromRackDiscovery } = require('../discovery/nordstromRackDiscovery');
  return runNordstromRackDiscovery();
}

module.exports = { scrapeNordstromRackProduct, scanNordstromRackDeals };

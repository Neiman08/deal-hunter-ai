/**
 * Office Depot product scraper
 * Extracts price, title, availability from Office Depot / OfficeMax product pages.
 */

const { newBestBuyContext } = require('../browserEngine');

const STORE_SLUG = 'office-depot';

async function scrapeOfficeDepotProduct(url) {
  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

    const data = await page.evaluate(() => {
      // LD+JSON
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (ld) {
        try {
          const parsed = JSON.parse(ld.textContent);
          const item = Array.isArray(parsed) ? parsed[0] : parsed;
          if (item?.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            // Extract was/regular price from Office Depot DOM
            // When on sale: od-price-reg shows "Reg. $X.XX" and od-graphql-price-big has "sale" class
            function extractWasPrice() {
              // Priority 1: .od-price-reg — shown as "Reg. $174.99" in the before-savings block
              const regEl = document.querySelector('.od-price-reg');
              if (regEl) {
                const m = regEl.textContent.match(/\$([\d,]+\.?\d*)/);
                if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
              }

              // Priority 2: .od-price-before-saving — contains "Reg.$X(You save $Y)"
              const beforeEl = document.querySelector('.od-price-before-saving, .od-price-reg-block');
              if (beforeEl) {
                const m = beforeEl.textContent.match(/\$([\d,]+\.?\d*)/);
                if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
              }

              // Priority 3: strikethrough or del elements
              for (const sel of ['del', 's', '[class*="strike"]', '[class*="was-price"]', '[class*="original-price"]']) {
                const el = document.querySelector(sel);
                if (!el) continue;
                const t = el.getAttribute('content') || el.textContent;
                const m = t && t.match(/\$([\d,]+\.?\d*)/);
                if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
              }
              return null;
            }
            const regularFromLd = parseFloat(offer?.highPrice) || null;
            return {
              name:         item.name || '',
              brand:        item.brand?.name || '',
              sku:          item.sku || item.mpn || '',
              currentPrice: parseFloat(offer?.price) || null,
              regularPrice: regularFromLd || extractWasPrice(),
              inStock:      offer?.availability?.includes('InStock') ?? false,
              imageUrl:     Array.isArray(item.image) ? item.image[0] : item.image,
              source:       'ld+json',
            };
          }
        } catch {}
      }

      // DOM fallback
      const name  = document.querySelector('h1.product-name, h1[itemprop="name"], [class*="product-title"]')?.textContent?.trim();
      const priceEl = document.querySelector('.od-graphql-price-big-price, [itemprop="price"], [class*="selling-price"], [class*="final-price"], .skuSalePrice, .skuFinalPrice');
      const regPriceEl = document.querySelector('.od-price-reg, [class*="was-price"], [class*="regular-price"], .skuWasPrice, [class*="original-price"]');
      const imgEl = document.querySelector('[itemprop="image"], .main-product-image img, [class*="product-image"] img');
      const stockEl = document.querySelector('[class*="availability"], [class*="in-stock"], [itemprop="availability"]');

      const priceText = priceEl?.getAttribute('content') || priceEl?.textContent?.trim();
      const regText   = regPriceEl?.textContent?.trim();
      const inStock   = !stockEl?.textContent?.toLowerCase().includes('out of stock');

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

async function scanOfficeDepotDeals() {
  const { runOfficeDepotDiscovery } = require('../discovery/officeDepotDiscovery');
  return runOfficeDepotDiscovery();
}

module.exports = { scrapeOfficeDepotProduct, scanOfficeDepotDeals };

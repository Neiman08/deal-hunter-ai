/**
 * Staples product scraper
 * Extracts price, title, availability from Staples product pages.
 */

const { newBestBuyContext } = require('../browserEngine');

const STORE_SLUG = 'staples';

async function scrapeStaplesProduct(url) {
  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

    const data = await page.evaluate(() => {
      // Helper: extract original/was price from Staples page
      function extractWasPrice() {
        // Priority 1: .price-info__originalPrice — stable semantic class
        // Shows "Original price is $659.99" when product is on promo
        const origEl = document.querySelector('.price-info__originalPrice, .price-info__strikethrough_price');
        if (origEl) {
          const m = origEl.textContent.match(/\$([\d,]+\.?\d*)/);
          if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
        }

        // Priority 2: .price-info__regular_price — container shown when on promo
        // Contains "Original price is $X" text
        const regEl = document.querySelector('.price-info__regular_price');
        if (regEl && regEl.classList.contains('price-info__has_promo')) {
          const m = regEl.textContent.match(/\$([\d,]+\.?\d*)/);
          if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
        }

        // Priority 3: screen-reader text — Staples embeds:
        // ",Regular pricewas$279.99,  You save 17%" (no space between "price" and "was")
        // Also: ",Regular pricewas$X," pattern
        let wasPrice = null;
        document.querySelectorAll('span, div, p').forEach(el => {
          if (wasPrice) return;
          // Skip large containers (only leaf-ish elements)
          if (el.children.length > 3) return;
          const t = el.textContent || '';
          // Match "was$X", "was $X", "pricewas$X", "Original price is $X"
          const m = t.match(/(?:was|Original\s+price\s+is)\s*\$?\s*([\d,]+\.?\d*)/i);
          if (m) {
            const v = parseFloat(m[1].replace(/,/g,''));
            if (v > 0) wasPrice = v;
          }
        });
        return wasPrice;
      }

      // LD+JSON for name/sku/image/currentPrice, then DOM for was-price
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (ld) {
        try {
          const parsed = JSON.parse(ld.textContent);
          const item = Array.isArray(parsed) ? parsed[0] : parsed;
          if (item?.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            return {
              name:         item.name || '',
              brand:        item.brand?.name || '',
              sku:          item.sku || item.mpn || '',
              currentPrice: parseFloat(offer?.price) || null,
              regularPrice: extractWasPrice(),
              inStock:      offer?.availability?.includes('InStock') ?? false,
              imageUrl:     Array.isArray(item.image) ? item.image[0] : item.image,
              source:       'ld+json',
            };
          }
        } catch {}
      }

      // DOM fallback — Staples uses specific class patterns
      const name  = document.querySelector('h1.product-name, h1[data-automation="productName"], .page-title h1')?.textContent?.trim();
      const priceEl = document.querySelector('[data-automation="sale-price"], [class*="sale-price"], [class*="priceReg"], .sfy-price-regular');
      const imgEl = document.querySelector('[data-automation="product-image"] img, .product-images__primary img, [class*="product-image"] img');
      const stockEl = document.querySelector('[data-automation="stock-status"], [class*="availability"], [class*="stock"]');

      const priceText = priceEl?.getAttribute('content') || priceEl?.textContent?.trim();
      const inStock   = !stockEl?.textContent?.toLowerCase().includes('out of stock');

      return {
        name,
        brand: '',
        sku: '',
        currentPrice: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) || null : null,
        regularPrice: extractWasPrice(),
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

async function scanStaplesDeals() {
  const { runStaplesDiscovery } = require('../discovery/staplesDiscovery');
  return runStaplesDiscovery();
}

module.exports = { scrapeStaplesProduct, scanStaplesDeals };

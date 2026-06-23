/**
 * GameStop product scraper
 * Extracts price, title, availability from GameStop product pages.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');

const STORE_SLUG = 'gamestop';

async function scrapeGameStopProduct(url) {
  const ctx  = process.env.PROXY_ENABLED === 'true' ? await newContext() : await newBestBuyContext();
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

    const data = await page.evaluate(() => {
      // Extract strikethrough / was-price from DOM
      function extractRegularPrice() {
        // Priority 1: explicit render-base-price element (used on sale/promo pages)
        const baseEl = document.querySelector('#render-base-price, .render-base-price');
        if (baseEl) {
          const m = baseEl.textContent.match(/\$([\d,]+\.?\d*)/);
          if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
        }

        // Priority 2: .strike-through.list — strikethrough element shown when product is on sale
        // GameStop uses class="strike-through list strike-redesign" on the was-price span
        const strikeEl = document.querySelector('.strike-through.list, .strike-redesign');
        if (strikeEl) {
          const m = strikeEl.textContent.match(/\$([\d,]+\.?\d*)/);
          if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
        }

        // Priority 3: .value span that appears immediately after the sale price span
        // Structure: <span class="actual-price-strikethroughable-span">$59.99</span>
        //            <span class="value">$79.99</span>
        const saleSpan = document.querySelector('.actual-price-strikethroughable-span, .actual-price');
        if (saleSpan) {
          const parent = saleSpan.parentElement;
          const valueEl = parent && parent.querySelector('.value');
          if (valueEl) {
            const m = valueEl.textContent.match(/\$([\d,]+\.?\d*)/);
            if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
          }
        }

        // Priority 4: .was-strike label's sibling price
        const wasLabel = document.querySelector('.was-strike');
        if (wasLabel) {
          const container = wasLabel.closest('[class*="price"]') || wasLabel.parentElement;
          const strikePrice = container && container.querySelector('[class*="strike-through"]');
          if (strikePrice) {
            const m = strikePrice.textContent.match(/\$([\d,]+\.?\d*)/);
            if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) return v; }
          }
        }

        return null;
      }

      // LD+JSON for name/sku/current price, DOM for was-price
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (ld) {
        try {
          const parsed = JSON.parse(ld.textContent);
          const item = Array.isArray(parsed) ? parsed[0] : parsed;
          if (item?.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            // LD+JSON may have highPrice (original) and lowPrice/price (sale)
            const regularFromLd = parseFloat(offer?.highPrice) || null;
            return {
              name:         item.name || '',
              brand:        item.brand?.name || '',
              sku:          item.sku || item.mpn || '',
              currentPrice: parseFloat(offer?.price) || null,
              regularPrice: regularFromLd || extractRegularPrice(),
              inStock:      offer?.availability?.includes('InStock') ?? false,
              imageUrl:     Array.isArray(item.image) ? item.image[0] : item.image,
              source:       'ld+json',
            };
          }
        } catch {}
      }

      // DOM fallback
      const name  = document.querySelector('h1.product-name, h1[class*="product-name"], .page-title')?.textContent?.trim();
      const priceEl = document.querySelector('[class*="final-sale"], [class*="actual-price"], [class*="price-sales"], .product-price [itemprop="price"]');
      const priceText = priceEl?.getAttribute('content') || priceEl?.textContent?.trim();
      const imgEl = document.querySelector('.primary-image, .product-primary-image img, [data-testid="productImage"] img');
      const stockEl = document.querySelector('[class*="stock-info"], [class*="availability"]');
      const inStock = !stockEl?.textContent?.toLowerCase().includes('out of stock');

      return {
        name,
        brand: '',
        sku: '',
        currentPrice: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) || null : null,
        regularPrice: extractRegularPrice(),
        inStock,
        imageUrl: imgEl?.src || null,
        source: 'dom',
      };
    });

    // If LD+JSON returned no SKU, extract numeric ID from URL: .../products/name/123456.html
    if (!data.sku) {
      const m = url.match(/\/(\d{5,8})\.html$/);
      if (m) data.sku = `gs-${m[1]}`;
    }
    return { ...data, productUrl: url, storeSlug: STORE_SLUG };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

async function scanGameStopDeals() {
  // Re-scan existing active GameStop deals for price changes.
  // Full discovery runs in the background worker — this only refreshes prices.
  const { query }           = require('../../config/database');
  const { saveProductData } = require('../scraperBase');
  const logger              = require('../../utils/logger');
  const BATCH               = parseInt(process.env.SCAN_BATCH_SIZE) || 10;

  logger.info('\n' + '═'.repeat(55));
  logger.info('🎮 GAMESTOP PRICE REFRESH SCAN');
  logger.info('═'.repeat(55));

  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.product_url,
           p.category_id, c.slug AS cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    JOIN deals d ON d.product_id = p.id AND d.is_active = true
    WHERE s.slug = 'gamestop'
      AND p.product_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prices pr
        WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '60 minutes'
      )
    ORDER BY d.opportunity_score DESC NULLS LAST
    LIMIT $1
  `, [BATCH]);

  logger.info(`[GS Scan] ${rows.rows.length} active deals queued for price refresh`);
  const stats = { scanned: 0, deals: 0, errors: 0 };
  let consecutiveFails = 0;
  const ABORT_THRESHOLD = 3;

  for (const p of rows.rows) {
    if (!p.product_url) continue;
    try {
      const scraped = await scrapeGameStopProduct(p.product_url);
      if (!scraped?.currentPrice || scraped.currentPrice <= 3) {
        consecutiveFails++;
        stats.errors++;
        continue;
      }
      consecutiveFails = 0;
      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 20) stats.deals++;
    } catch (err) {
      consecutiveFails++;
      logger.error(`[GS Scan] FAIL "${p.name?.slice(0, 50)}": ${err.message}`);
      stats.errors++;
      if (consecutiveFails >= ABORT_THRESHOLD) {
        logger.warn(`[GS Scan] ${consecutiveFails} consecutive failures — aborting early`);
        break;
      }
    }
  }

  logger.info(`[GS Scan] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeGameStopProduct, scanGameStopDeals };

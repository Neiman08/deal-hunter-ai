/**
 * Best Buy Playwright Scraper v4
 *
 * FUENTE DE DATOS: columna `bestbuy_sku` (numérico, ej: 6505727)
 * NUNCA usa la columna `sku` (modelo del fabricante, ej: OLED65C3PUA)
 *
 * REGLA:
 *   bestbuy_sku  → numérico 5-8 dígitos → válido para construir URLs
 *   sku          → modelo del fabricante → SOLO para referencia, NUNCA para URLs
 *
 * FLUJO:
 *   1. Query: WHERE bestbuy_sku_valid = true
 *   2. resolveProductUrl(bestbuy_sku) via searchpage.jsp
 *   3. scrapeProductPage(url_real)
 *   4. Guardar product_url real en DB para skippear búsqueda en futuros scans
 *
 * PROTECCIONES:
 *   - Detección CAPTCHA / Access Denied / HTTP2 errors
 *   - Screenshot automático en fallo → logs/screenshots/bestbuy/
 *   - Reintento con User-Agent rotativo + contexto nuevo
 *   - Warning + skip para cualquier bestbuy_sku no numérico
 */

const path   = require('path');
const fs     = require('fs');
const { newBestBuyContext } = require('../browserEngine');
const {
  withRetry, respectDomainDelay, makeProduct,
  extractPrice, extractFromPageJSON, calcDiscount, saveProductData,
} = require('../scraperBase');
const { query }  = require('../../config/database');
const logger     = require('../../utils/logger');

const STORE_SLUG = 'best-buy';
const DOMAIN     = 'bestbuy.com';

// ── Screenshot dir ────────────────────────────────────────────────────────────
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../../logs/screenshots/bestbuy');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── User-Agent rotation pool ──────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
let uaIndex = 0;
const nextUA = () => USER_AGENTS[uaIndex++ % USER_AGENTS.length];

// ── Price selectors ───────────────────────────────────────────────────────────
const PRICE_SELECTORS = [
  '[data-testid="customer-price"] span[aria-hidden="true"]',
  '.priceView-customer-price span[aria-hidden="true"]',
  '[class*="priceView-hero-price"] span[aria-hidden="true"]',
  '[class*="PriceInfoBlock"] span[aria-hidden="true"]',
  '[data-testid="price-block"] span[aria-hidden="true"]',
  '.priceView-price span',
];

const REGULAR_PRICE_SELECTORS = [
  '[data-testid="regular-price"] span[aria-hidden="true"]',
  '.priceView-was-price span[aria-hidden="true"]',
  '[class*="WasPriceBlock"] span[aria-hidden="true"]',
  '.was-price span',
];

// ── SKU validation ────────────────────────────────────────────────────────────
const BB_SKU_REGEX = /^\d{5,8}$/;

function isValidBestBuySku(sku) {
  return sku && BB_SKU_REGEX.test(String(sku).trim());
}

/** True when URL has the correct /site/slug/sku.p pattern */
function isValidProductUrl(url) {
  return Boolean(url && /bestbuy\.com\/site\/.+\/\d{5,8}\.p/.test(url));
}

// ── URL helpers ───────────────────────────────────────────────────────────────
function toAbsolute(url) {
  if (!url) return null;
  url = String(url).trim();
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  if (url.startsWith('//'))  return 'https:' + url;
  if (url.startsWith('/'))   return 'https://www.bestbuy.com' + url;
  return 'https://www.bestbuy.com/' + url;
}

// ── Screenshot helper ─────────────────────────────────────────────────────────
async function saveScreenshot(page, label) {
  try {
    const ts   = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(SCREENSHOT_DIR, `${label}-${ts}.png`);
    await page.screenshot({ path: file, fullPage: false });
    logger.warn(`[BestBuy] Screenshot → ${file}`);
    return file;
  } catch (e) {
    logger.warn(`[BestBuy] Screenshot failed: ${e.message}`);
    return null;
  }
}

// ── Block detection ───────────────────────────────────────────────────────────
async function detectBlock(page) {
  const title = await page.title().catch(() => '');
  const url   = page.url();
  logger.info(`[BestBuy] page.title()="${title}" | url=${url}`);

  if (/captcha|robot|verify you are human/i.test(title))
    return `CAPTCHA (title: "${title}")`;
  if (/access denied|403|forbidden/i.test(title))
    return `Access Denied/403 (title: "${title}")`;
  if (/ERR_|net::|connection refused/i.test(title))
    return `Network error (title: "${title}")`;

  let bodyLen = 0;
  try { bodyLen = await page.$eval('html', el => el.innerHTML.length); } catch {}
  if (bodyLen < 1000)
    return `Page too short — ${bodyLen} chars — likely empty or blocked`;

  try {
    const body = await page.$eval('body', el => el.innerText?.slice(0, 400) || '');
    if (/access denied|blocked|unusual traffic|verify your identity/i.test(body))
      return `Blocked — body: "${body.slice(0, 100)}"`;
  } catch {}

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Search page → resolve real product URL
// ─────────────────────────────────────────────────────────────────────────────
async function resolveProductUrl(bbSku, attempt = 1) {
  if (!isValidBestBuySku(bbSku)) {
    throw new Error(
      `resolveProductUrl called with invalid SKU: "${bbSku}". ` +
      `Must be a 5-8 digit numeric string (e.g. 6505727). ` +
      `This is a bestbuy_sku, not a manufacturer model number.`
    );
  }

  const searchUrl = `https://www.bestbuy.com/site/searchpage.jsp?st=${bbSku}`;
  logger.info(`[BestBuy] resolveProductUrl | bestbuy_sku=${bbSku} | attempt=${attempt}`);
  logger.info(`[BestBuy] searchUrl: ${searchUrl}`);

  await respectDomainDelay(DOMAIN);

  const ctx  = await newBestBuyContext({ userAgent: nextUA() });
  const page = await ctx.newPage();

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const searchTitle = await page.title().catch(() => '?');
    logger.info(`[BestBuy] Search page title: "${searchTitle}"`);

    const block = await detectBlock(page);
    if (block) {
      await saveScreenshot(page, `resolve-blocked-${bbSku}-a${attempt}`);
      throw new Error(`Search page blocked: ${block}`);
    }

    // Wait for product list
    try {
      await page.waitForSelector(
        '.sku-item, [data-component="ProductList"], [class*="SearchResultList"]',
        { timeout: 12000 }
      );
    } catch {
      logger.warn('[BestBuy] Search result container timeout — attempting extraction anyway');
    }

    // ── Extract real product URL ──────────────────────────────────────────
    const rawUrl = await page.evaluate((sku) => {
      // A: anchor with numeric SKU in href
      const bySkuAnchor = document.querySelector(`a[href*="${sku}.p"]`);
      if (bySkuAnchor) {
        return bySkuAnchor.getAttribute('href') || bySkuAnchor.href;
      }

      // B: first product card image link
      const cardLink = document.querySelector(
        '.sku-item a.image-link, .sku-item a[href*="/site/"], [class*="ProductItem"] a[href*="/site/"]'
      );
      if (cardLink?.href) return cardLink.href;

      // C: __INITIAL_STATE__ search results
      try {
        const s = window?.__INITIAL_STATE__;
        const items = s?.search?.searchResults?.items
                   || s?.search?.results
                   || s?.searchResults?.items
                   || [];
        const exact = items.find(i => String(i.sku) === String(sku));
        const item  = exact || items[0];
        if (!item) return null;
        if (item.url) return item.url;
        if (item.addToCartUrl) {
          const m = item.addToCartUrl.match(/\/site\/.+?\.p/);
          if (m) return m[0];
        }
      } catch {}

      // D: LD+JSON ItemList
      try {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          const d    = JSON.parse(s.textContent);
          const list = d?.itemListElement || (Array.isArray(d) ? d : []);
          for (const entry of list) {
            const u = entry?.item?.url || entry?.url || '';
            if (u && u.includes(sku)) return u;
          }
        }
      } catch {}

      return null;
    }, String(bbSku));

    logger.info(`[BestBuy] Raw URL from page: ${rawUrl ?? 'null'}`);

    if (rawUrl) {
      const absolute = toAbsolute(rawUrl);
      logger.info(`[BestBuy] Normalized productUrl: ${absolute}`);
      if (!isValidProductUrl(absolute)) {
        logger.warn(`[BestBuy] URL found but doesn't match expected pattern: ${absolute}`);
      }
      return absolute;
    }

    // Failed — log diagnostic info and screenshot
    const firstLinks = await page.$$eval(
      'a[href*="bestbuy.com/site"], a[href*="/site/"]',
      els => els.slice(0, 5).map(a => a.getAttribute('href') || a.href)
    ).catch(() => []);
    const bodySnip = await page.$eval('body', el => el.innerText?.slice(0, 300)).catch(() => '');

    logger.warn('[BestBuy] resolveProductUrl — no URL found');
    logger.warn(`  searchUrl:    ${searchUrl}`);
    logger.warn(`  title:        "${searchTitle}"`);
    logger.warn(`  links found:  ${firstLinks.map(toAbsolute).join(', ') || 'none'}`);
    logger.warn(`  body snippet: "${bodySnip.replace(/\n/g, ' ')}"`);

    await saveScreenshot(page, `resolve-no-url-${bbSku}-a${attempt}`);
    return null;

  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Scrape real product page
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeProductPage(productUrl, attempt = 1) {
  logger.info(`[BestBuy] scrapeProductPage | attempt=${attempt} | url=${productUrl}`);
  await respectDomainDelay(DOMAIN);

  const ctx  = await newBestBuyContext({ userAgent: nextUA() });
  const page = await ctx.newPage();

  try {
    // ── Goto tolerante a ERR_HTTP2_PROTOCOL_ERROR y timeouts ──────────────
    // Cuando BB lanza ese error, el HTML ya llegó — el error es del stream,
    // no de la carga del contenido. Capturamos y leemos lo que haya.
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (gotoErr) {
      const isHttp2 = gotoErr.message.includes('ERR_HTTP2_PROTOCOL_ERROR');
      const isTime  = gotoErr.message.includes('Timeout') || gotoErr.message.includes('timeout');

      if (isHttp2 || isTime) {
        logger.warn(`[BestBuy] goto ${isHttp2 ? 'HTTP2_ERROR' : 'TIMEOUT'} — esperando JS post-carga...`);
        await page.waitForTimeout(8000);
      } else {
        throw gotoErr;
      }
    }

    // ── Validar que la página cargó algo útil ─────────────────────────────
    // Si goto falló y la página está en blanco o about:blank, no tiene sentido continuar.
    const productTitle = await page.title().catch(() => '');
    const finalUrl     = page.url();
    const bodyLen      = await page.$eval('html', el => el.innerHTML?.length || 0).catch(() => 0);

    logger.info(`[BestBuy] title="${productTitle}" | url=${finalUrl} | bodyLen=${bodyLen}`);

    if (!productTitle && (finalUrl === 'about:blank' || bodyLen < 500)) {
      throw new Error(
        `Página vacía después de goto — title="${productTitle}" url="${finalUrl}" bodyLen=${bodyLen}. ` +
        `La página no cargó contenido útil.`
      );
    }

    const block = await detectBlock(page);
    if (block) {
      await saveScreenshot(page, `product-blocked-a${attempt}`);
      throw new Error(`Product page blocked: ${block}`);
    }

    // ── M1: window.__INITIAL_STATE__ (JSON — sin esperar selectores visuales) ──
    // Priorizar extracción desde JSON. React puede no haber renderizado el DOM
    // todavía, pero __INITIAL_STATE__ ya está disponible tras domcontentloaded.
    const state = await extractFromPageJSON(page, () => {
      try {
        const s = window?.__INITIAL_STATE__;
        if (!s) return null;

        const pdp = s?.pdp?.listings?.primary
                 || s?.page?.data?.pageData?.product
                 || s?.productDetail?.pdpData?.product
                 || s?.recommendations?.product
                 || null;

        if (!pdp) {
          const raw = JSON.stringify(s);
          const pm  = raw.match(/"(?:salePrice|currentPrice)"\s*:\s*([\d.]+)/);
          const nm  = raw.match(/"(?:name|title|productTitle)"\s*:\s*"([^"]{10,200})"/);
          const skm = raw.match(/"sku"\s*:\s*"?(\d{5,8})"?/);
          if (pm) return { currentPrice: parseFloat(pm[1]), name: nm?.[1], sku: skm?.[1], _via: 'raw_regex' };
          return null;
        }

        const pricing = pdp.priceInfo || pdp.pricing || {};
        return {
          name:         pdp.name || pdp.title || pdp.productTitle,
          brand:        pdp.brand || pdp.manufacturer,
          sku:          String(pdp.sku || ''),
          currentPrice: pricing.currentPrice ?? pricing.salePrice ?? pdp.salePrice ?? pdp.price,
          regularPrice: pricing.regularPrice ?? pdp.regularPrice ?? null,
          openBoxPrice: pdp.openBoxPrice ?? null,
          clearance:    Boolean(pdp.clearance),
          dealOfTheDay: Boolean(pdp.dealEndDate),
          inStock:      pdp.onlineAvailability !== false,
          imageUrl:     pdp.image || pdp.thumbnailImage || null,
        };
      } catch { return null; }
    }, '__INITIAL_STATE__');

    if (state?.currentPrice) {
      logger.info(`[BestBuy] ✅ M1 __INITIAL_STATE__${state._via ? ` (${state._via})` : ''} | "${state.name}" | $${state.currentPrice}`);
      return makeProduct({
        name: state.name, brand: state.brand, sku: state.sku,
        currentPrice: state.currentPrice,
        regularPrice: state.regularPrice || state.currentPrice * 1.25,
        discountPercent: calcDiscount(state.currentPrice, state.regularPrice),
        inStock: state.inStock, imageUrl: state.imageUrl, productUrl,
        openBoxPrice: state.openBoxPrice, clearance: state.clearance,
        dealOfTheDay: state.dealOfTheDay,
        pageText: [
          state.clearance    && 'clearance',
          state.dealOfTheDay && 'deal of the day',
          state.openBoxPrice && 'open box',
        ].filter(Boolean).join(' '),
        source: 'bestbuy_playwright_state',
      });
    }

    // ── M2: LD+JSON structured data ───────────────────────────────────────
    const ld = await extractFromPageJSON(page, () => {
      try {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          const d     = JSON.parse(s.textContent);
          const offer = d?.offers || (Array.isArray(d) ? d[0]?.offers : null);
          if (offer?.price) return {
            name: d.name, brand: d.brand?.name,
            currentPrice: parseFloat(offer.price),
            inStock: offer.availability?.includes('InStock') ?? true,
            imageUrl: Array.isArray(d.image) ? d.image[0] : d.image,
          };
        }
        return null;
      } catch { return null; }
    }, 'LD+JSON');

    if (ld?.currentPrice) {
      logger.info(`[BestBuy] ✅ M2 LD+JSON | "${ld.name}" | $${ld.currentPrice}`);
      return makeProduct({
        name: ld.name, brand: ld.brand,
        currentPrice: ld.currentPrice, regularPrice: ld.currentPrice * 1.25,
        inStock: ld.inStock, imageUrl: ld.imageUrl, productUrl,
        source: 'bestbuy_playwright_ldjson',
      });
    }

    // ── M3: Scripts con price/salePrice/sku embebidos ─────────────────────
    // Busca en cualquier <script> que tenga datos de precio — antes de DOM selectors.
    const scriptData = await extractFromPageJSON(page, () => {
      try {
        const scripts = [...document.querySelectorAll('script:not([src])')];
        for (const s of scripts) {
          const t = s.textContent || '';
          if (!t.includes('salePrice') && !t.includes('currentPrice')) continue;
          const pm  = t.match(/"(?:salePrice|currentPrice)"\s*:\s*([\d.]+)/);
          const nm  = t.match(/"(?:name|productTitle|title)"\s*:\s*"([^"]{5,200})"/);
          const skm = t.match(/"sku"\s*:\s*"?(\d{5,8})"?/);
          if (pm) return {
            currentPrice: parseFloat(pm[1]),
            name: nm?.[1],
            sku:  skm?.[1],
          };
        }
        return null;
      } catch { return null; }
    }, 'inline_script');

    if (scriptData?.currentPrice) {
      logger.info(`[BestBuy] ✅ M3 inline script | "${scriptData.name}" | $${scriptData.currentPrice}`);
      return makeProduct({
        name: scriptData.name, sku: scriptData.sku,
        currentPrice: scriptData.currentPrice,
        regularPrice: scriptData.currentPrice * 1.25,
        productUrl, source: 'bestbuy_playwright_script',
      });
    }

    // ── M4: DOM selectors (último recurso — React puede no haber hidratado) ──
    logger.info('[BestBuy] M4 — DOM selectors (last resort)...');
    const currentPrice = await extractPrice(page, PRICE_SELECTORS, 'BB current price');

    if (!currentPrice) {
      await saveScreenshot(page, `no-price-a${attempt}`);
      const bodySnip = await page.$eval('body', el => el.innerText?.slice(0, 400)).catch(() => '');
      throw new Error(
        `M1+M2+M3+M4 all failed — no price.\n` +
        `  title="${productTitle}" bodyLen=${bodyLen}\n` +
        `  body: "${bodySnip.replace(/\n/g, ' ')}"`
      );
    }

    const regularPrice = await extractPrice(page, REGULAR_PRICE_SELECTORS, 'BB regular price');
    const name         = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null);
    const imageUrl     = await page.$eval(
      '.primary-image img, [data-testid="primary-image"] img, [class*="PrimaryImage"] img',
      el => el.src
    ).catch(() => null);
    const inStock      = await page.$('button[data-button-state="ADD_TO_CART"]').then(Boolean).catch(() => true);
    const clearanceEl  = await page.$('[class*="clearance"], [data-testid="clearance-badge"]').then(Boolean).catch(() => false);
    const openBoxEl    = await page.$('[class*="openBox"], [data-testid="open-box"]').then(Boolean).catch(() => false);
    const pageText     = await page.$eval('body', el => el.innerText?.slice(0, 1000)).catch(() => '');

    logger.info(`[BestBuy] ✅ M4 DOM | "${name}" | $${currentPrice}`);
    return makeProduct({
      name, currentPrice,
      regularPrice: regularPrice || currentPrice * 1.25,
      discountPercent: calcDiscount(currentPrice, regularPrice),
      inStock, imageUrl, productUrl,
      clearance:    clearanceEl || pageText.toLowerCase().includes('clearance'),
      openBoxPrice: openBoxEl   ? currentPrice * 0.85 : null,
      pageText:     (clearanceEl ? 'clearance ' : '') + (openBoxEl ? 'open box ' : '') + pageText,
      source: 'bestbuy_playwright_dom',
    });

  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY — validates, resolves, scrapes
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeBestBuyProduct(input) {
  if (!input) throw new Error('[BestBuy] Missing input');

  const raw = String(input).trim();

  // URL completa nueva o vieja
  if (/^https?:\/\//i.test(raw)) {
    if (raw.includes('bestbuy.com/product/') || raw.includes('bestbuy.com/site/')) {
      logger.info(`[BestBuy] Direct product URL accepted: ${raw}`);
      return await scrapeProductPage(raw, 1);
    }

    if (raw.includes('bestbuy.com/search') || raw.includes('searchpage.jsp')) {
      const u = new URL(raw);
      const q = u.searchParams.get('search') || u.searchParams.get('st') || raw;
      const resolved = await resolveProductUrl(q);
      if (!resolved) throw new Error(`[BestBuy] Could not resolve product URL from search URL: ${raw}`);
      return await scrapeProductPage(resolved, 1);
    }

    throw new Error(`[BestBuy] Unsupported Best Buy URL: ${raw}`);
  }

  // Acepta SKU numérico clásico o Product ID nuevo alfanumérico
  const searchTerm = raw;
  let productUrl = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      productUrl = await resolveProductUrl(searchTerm, attempt);
      if (productUrl) break;
    } catch (err) {
      logger.error(`[BestBuy] resolveProductUrl attempt ${attempt}: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (!productUrl) {
    throw new Error(`[BestBuy] Could not resolve product URL for input=${searchTerm}`);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await scrapeProductPage(productUrl, attempt);
    } catch (err) {
      logger.error(`[BestBuy] scrapeProductPage attempt ${attempt}/3: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
      else throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH SCAN — uses bestbuy_sku exclusively
// ─────────────────────────────────────────────────────────────────────────────
async function scanBestBuyDeals() {
  logger.info('\n' + '═'.repeat(60));
  logger.info('🟦 BEST BUY PLAYWRIGHT SCAN v4');
  logger.info('═'.repeat(60));

  // ── Report invalid products (skipped) ────────────────────────────────────
  const invalidRows = await query(`
    SELECT p.name, p.sku, p.bestbuy_sku, p.bestbuy_sku_valid
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'best-buy'
      AND (p.bestbuy_sku_valid = false OR p.bestbuy_sku IS NULL)
  `);

  if (invalidRows.rows.length) {
    logger.warn(`\n[BestBuy] ⚠️  ${invalidRows.rows.length} product(s) will be SKIPPED (missing or invalid bestbuy_sku):`);
    invalidRows.rows.forEach(r => {
      logger.warn(
        `  "${r.name}" | sku="${r.sku}" (manufacturer) | ` +
        `bestbuy_sku="${r.bestbuy_sku ?? 'NULL'}" | valid=${r.bestbuy_sku_valid ?? 'NULL'}\n` +
        `  → Fix: run UPDATE products SET bestbuy_sku='XXXXXXX', bestbuy_sku_valid=true WHERE name='${r.name}';`
      );
    });
    logger.warn('');
  }

  // ── Fetch valid products only ─────────────────────────────────────────────
  const rows = await query(`
    SELECT p.id, p.name, p.brand, p.sku, p.bestbuy_sku, p.product_url,
           p.category_id, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    JOIN stores s ON p.store_id = s.id
    WHERE s.slug = 'best-buy'
      AND p.bestbuy_sku_valid = true
      AND p.bestbuy_sku ~ '^[0-9]{5,8}$'
      AND NOT EXISTS (
        SELECT 1 FROM prices pr
        WHERE pr.product_id = p.id
          AND pr.recorded_at > NOW() - INTERVAL '30 minutes'
      )
    ORDER BY RANDOM()
    LIMIT ${parseInt(process.env.SCAN_BATCH_SIZE) || 10}
  `);

  logger.info(`[BestBuy] ${rows.rows.length} valid products queued for scan`);

  const stats = { scanned: 0, deals: 0, errors: 0, skipped: 0 };

  for (const p of rows.rows) {
    // Always prefer a known valid product URL (skips the search step)
    const input = isValidProductUrl(p.product_url)
      ? p.product_url
      : p.bestbuy_sku;  // guaranteed numeric by the WHERE clause above

    logger.info(`\n[BestBuy] "${p.name}"`);
    logger.info(`  manufacturer_sku = "${p.sku}"`);
    logger.info(`  bestbuy_sku      = "${p.bestbuy_sku}"`);
    logger.info(`  product_url      = "${p.product_url ?? 'NULL (will search)'}"`);
    logger.info(`  → input for scraper: ${input}`);

    try {
      const scraped = await scrapeBestBuyProduct(input);

      if (!scraped?.currentPrice) {
        logger.error(`[BestBuy] No price for "${p.name}"`);
        stats.errors++;
        continue;
      }

      // Save the resolved product URL for future scans
      if (scraped.productUrl && isValidProductUrl(scraped.productUrl) && scraped.productUrl !== p.product_url) {
        await query(
          'UPDATE products SET product_url = $1, updated_at = NOW() WHERE id = $2',
          [scraped.productUrl, p.id]
        );
        logger.info(`[BestBuy] Saved productUrl: ${scraped.productUrl}`);
      }

      stats.scanned++;
      const r = await saveProductData(p, scraped, STORE_SLUG);
      if (r?.discountPct >= 10) stats.deals++;

    } catch (err) {
      logger.error(`[BestBuy] FAIL "${p.name}" (bestbuy_sku=${p.bestbuy_sku}): ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(`\n[BestBuy] COMPLETE | scanned:${stats.scanned} deals:${stats.deals} errors:${stats.errors} skipped:${stats.skipped}`);
  return { products_scanned: stats.scanned, deals_found: stats.deals, errors: stats.errors };
}

module.exports = { scrapeBestBuyProduct, scanBestBuyDeals, resolveProductUrl, isValidBestBuySku, isValidProductUrl };

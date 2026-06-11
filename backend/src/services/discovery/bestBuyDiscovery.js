/**
 * Best Buy Discovery Engine
 *
 * DIAGNÓSTICO (2026-06-03):
 * ✅ searchpage.jsp carga correctamente
 * ❌ product pages → ERR_HTTP2_PROTOCOL_ERROR (rechazo TCP/TLS)
 * ❌ axios directo → timeout
 *
 * ESTRATEGIA: extraer datos directamente de los cards de búsqueda.
 * No abrir páginas de producto. Search → cards → price/deal.
 *
 * Los cards de Best Buy exponen en __INITIAL_STATE__ y en el DOM:
 * name, skuId, currentPrice, regularPrice, imageUrl, inStock
 *
 * Flujo:
 * 1. Abrir searchpage.jsp?st={keyword}
 * 2. Extraer datos de todos los product cards visibles
 * 3. Dedup contra products.product_url
 * 4. Upsert en products + prices + deals directamente
 * SIN abrir la página del producto
 */

const { newBestBuyDiscoveryContext: newBestBuyContext }  = require('../browserEngine');
const { saveProductData }    = require('../scraperBase');
const { query }              = require('../../config/database');
const { writeStoreRun }      = require('../../utils/storeRunStats');
const logger                 = require('../../utils/logger');

const STORE_SLUG = 'best-buy';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Phase 4: expanded to 50+ keywords targeting 500-1000 products per cycle
// Keyword groups — one group runs per 30-min cycle in rotation
const BB_KEYWORD_GROUPS = {
  clearance: [
    { label: 'best-buy-deals',        kw: 'best buy deals' },
    { label: 'deal-of-the-day',       kw: 'deal of the day' },
    { label: 'clearance-electronics', kw: 'clearance electronics' },
    { label: 'clearance-appliance',   kw: 'clearance appliance' },
    { label: 'clearance-camera',      kw: 'clearance camera' },
    { label: 'clearance-phone',       kw: 'clearance smartphone' },
    { label: 'clearance-tablet',      kw: 'clearance tablet' },
    { label: 'clearance-headphones',  kw: 'clearance headphones' },
  ],
  open_box: [
    { label: 'open-box-tv',           kw: 'open box tv' },
    { label: 'open-box-oled',         kw: 'open box oled' },
    { label: 'open-box-laptop',       kw: 'open box laptop' },
    { label: 'open-box-samsung',      kw: 'open box samsung' },
    { label: 'open-box-headphones',   kw: 'open box headphones' },
    { label: 'open-box-speaker',      kw: 'open box speaker' },
    { label: 'open-box-gaming',       kw: 'open box gaming' },
    { label: 'outlet-tv',             kw: 'outlet tv' },
    { label: 'outlet-laptop',         kw: 'outlet laptop' },
  ],
  tv: [
    { label: 'search-tv',             kw: 'tv 4k' },
    { label: 'search-oled',           kw: 'oled tv' },
    { label: 'clearance-tv',          kw: 'clearance tv' },
    { label: 'lg-deals',              kw: 'lg deals' },
    { label: 'samsung-tv',            kw: 'samsung tv' },
    { label: 'sony-tv',               kw: 'sony tv' },
    { label: 'search-soundbar',       kw: 'soundbar' },
    { label: 'search-projector',      kw: 'projector 4k' },
  ],
  laptops: [
    { label: 'search-laptop',         kw: 'laptop' },
    { label: 'clearance-laptop',      kw: 'clearance laptop' },
    { label: 'outlet-laptop',         kw: 'outlet laptop' },
    { label: 'gaming-laptop-deals',   kw: 'gaming laptop deals' },
    { label: 'search-monitor',        kw: '4k monitor' },
    { label: 'microsoft-deals',       kw: 'microsoft deals' },
    { label: 'search-printer',        kw: 'laser printer' },
    { label: 'search-smart-display',  kw: 'smart display' },
  ],
  apple: [
    { label: 'apple-deals',           kw: 'apple deals' },
    { label: 'search-macbook',        kw: 'macbook' },
    { label: 'search-ipad',           kw: 'ipad' },
    { label: 'search-iphone',         kw: 'iphone' },
    { label: 'search-airpods',        kw: 'airpods' },
    { label: 'open-box-macbook',      kw: 'open box macbook' },
    { label: 'open-box-ipad',         kw: 'open box ipad' },
    { label: 'open-box-iphone',       kw: 'open box iphone' },
  ],
  headphones: [
    { label: 'search-headphones',     kw: 'noise cancelling headphones' },
    { label: 'bose-deals',            kw: 'bose deals' },
    { label: 'sony-deals',            kw: 'sony deals' },
    { label: 'clearance-headphones',  kw: 'clearance headphones' },
    { label: 'open-box-headphones',   kw: 'open box headphones' },
    { label: 'search-smartwatch',     kw: 'smartwatch' },
    { label: 'search-earbuds',        kw: 'wireless earbuds' },
  ],
  speakers: [
    { label: 'open-box-speaker',      kw: 'open box speaker' },
    { label: 'search-soundbar',       kw: 'soundbar' },
    { label: 'bose-speaker',          kw: 'bose speaker' },
    { label: 'sonos',                 kw: 'sonos' },
    { label: 'search-smart-speaker',  kw: 'smart speaker' },
    { label: 'search-home-theater',   kw: 'home theater system' },
    { label: 'search-espresso',       kw: 'espresso machine' },
  ],
  gaming: [
    { label: 'search-gaming',         kw: 'gaming' },
    { label: 'search-ps5',            kw: 'playstation 5' },
    { label: 'search-xbox',           kw: 'xbox series' },
    { label: 'open-box-gaming',       kw: 'open box gaming' },
    { label: 'gaming-laptop-deals',   kw: 'gaming laptop deals' },
    { label: 'clearance-gaming',      kw: 'clearance gaming' },
    { label: 'gaming-chair',          kw: 'gaming chair' },
    { label: 'gaming-headset',        kw: 'gaming headset' },
  ],
  outlet: [
    { label: 'outlet-tv',             kw: 'outlet tv' },
    { label: 'outlet-laptop',         kw: 'outlet laptop' },
    { label: 'outlet-samsung',        kw: 'outlet samsung' },
    { label: 'outlet-apple',          kw: 'outlet apple' },
    { label: 'clearance-camera',      kw: 'clearance camera' },
    { label: 'search-dash-cam',       kw: 'dash cam' },
    { label: 'search-camera',         kw: 'mirrorless camera' },
    { label: 'dyson-deals',           kw: 'dyson deals' },
    { label: 'search-vacuum',         kw: 'robot vacuum' },
  ],
  brands: [
    { label: 'samsung-deals',         kw: 'samsung deals' },
    { label: 'lg-deals',              kw: 'lg deals' },
    { label: 'dyson-deals',           kw: 'dyson deals' },
    { label: 'bose-deals',            kw: 'bose deals' },
    { label: 'sony-deals',            kw: 'sony deals' },
    { label: 'microsoft-deals',       kw: 'microsoft deals' },
    { label: 'search-keurig',         kw: 'keurig' },
    { label: 'search-kitchenaid',     kw: 'kitchenaid' },
  ],
};

// Flat list for backwards compatibility (used when options.keywords is explicitly passed)
const SEARCH_KEYWORDS = Object.values(BB_KEYWORD_GROUPS).flat();

// ─────────────────────────────────────────────────────────────────────────────
// Cerrar popups y overlays antes de extraer cards
// Popups observados en Best Buy: ubicación, login, traductor de Google
// ─────────────────────────────────────────────────────────────────────────────
async function dismissOverlays(page) {
  // Selectores de botones de cierre (probados en orden de especificidad)
  const closeSelectors = [
    // Popup de ubicación "wants to know your location"
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '[data-testid="close-button"]',
    // Modal genérico / dialog
    '[role="dialog"] button[aria-label*="lose"]',
    '[role="dialog"] button[aria-label*=" dismiss"]',
    '[role="dialog"] button[aria-label*="cancel"]',
    // Modales por clase
    '.modal button[aria-label*="lose"]',
    '.c-modal-close',
    '.c-close-button',
    // Popup de login "Sign In"
    '[data-testid*="modal"] button[aria-label*="lose"]',
    '[data-testid*="modal"] .c-close-button',
    // Overlay genérico con botón × o X
    '.overlay-close',
    'button.close',
  ];

  let closed = 0;

  for (const sel of closeSelectors) {
    try {
      // Busca TODOS los botones que coincidan (puede haber varios overlays)
      const buttons = await page.$$(sel);
      for (const btn of buttons) {
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click({ timeout: 2000 }).catch(() => {});
          await sleep(400);
          closed++;
          logger.info(`[Discovery:BB]   Closed overlay: "${sel}"`);
        }
      }
    } catch {}
  }

  // Escapar con teclado como fallback (cierra la mayoría de modales)
  if (closed === 0) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
  }

  // Verificar que no queden dialogs bloqueando
  const dialogCount = await page.$$eval(
    '[role="dialog"]:not([hidden]), .modal:not(.hidden)',
    els => els.filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).length
  ).catch(() => 0);

  if (dialogCount > 0) {
    logger.warn(`[Discovery:BB]   ${dialogCount} dialog(s) still visible after dismissal`);
  } else if (closed > 0) {
    logger.info(`[Discovery:BB]   All overlays dismissed (${closed} closed)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraer datos de product cards desde una search page
// Devuelve array de objetos con datos completos — sin abrir ninguna página extra
// ─────────────────────────────────────────────────────────────────────────────
async function extractCardsFromSearchPage(keyword, maxCards = 20) {
  const url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(keyword)}`;
  logger.info(`[Discovery:BB] Search: "${keyword}" | ${url}`);

  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();
  const cards = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Detectar chrome-error
    if (page.url().startsWith('chrome-error://')) {
      logger.warn(`[Discovery:BB] chrome-error para "${keyword}"`);
      return [];
    }

    const title = await page.title().catch(() => '');
    logger.info(`[Discovery:BB]   title: "${title}"`);

    if (/captcha|robot|access denied/i.test(title)) {
      logger.warn(`[Discovery:BB]   Blocked: "${title}"`);
      return [];
    }

    // Cerrar overlays
    await dismissOverlays(page);

    // Esperar el contenedor real de cards (confirmado por inspector)
    try {
      await page.waitForSelector('li.sku-item, .sku-item, [data-testid="product-card"], div[data-sku-id]', { timeout: 15000 });
    } catch {
      logger.warn('[Discovery:BB]   Card container timeout — extracting anyway');
    }

    // Scroll completo para cargar lazy-load
    const countBefore = await page.$$eval('li.sku-item, .sku-item, [data-testid="product-card"], div[data-sku-id]', els => els.length).catch(() => 0);
    logger.info(`[Discovery:BB]   Cards antes del scroll: ${countBefore}`);

    await page.evaluate(async () => {
      const limit = Math.max(document.body.scrollHeight, 5000);
      for (let pos = 0; pos < limit; pos += 600) {
        window.scrollBy(0, 600);
        await new Promise(r => setTimeout(r, 350));
      }
      window.scrollTo(0, 0);
    });
    await sleep(1200);

    const countAfter = await page.$$eval('li.sku-item, .sku-item, [data-testid="product-card"], div[data-sku-id]', els => els.length).catch(() => 0);
    logger.info(`[Discovery:BB]   Cards después del scroll: ${countAfter}`);

    // ── Extracción principal: Contenedores actualizados ────────────────────
    // Inspector confirmó: __INITIAL_STATE__ = null en BB actual.
    // Precio se busca DENTRO del card para evitar leer filtros laterales.
    const extracted = await page.evaluate((max) => {
      const results = [];
      const seen    = new Set(); // dedup por productUrl

      // Contenedores confirmados por inspector
      const containers = [
        ...document.querySelectorAll('li.sku-item'),
        ...document.querySelectorAll('.sku-item'),
        ...document.querySelectorAll('[data-testid="product-card"]'),
        ...document.querySelectorAll('[data-testid*="shop-product-card"]'),
        ...document.querySelectorAll('div[data-sku-id]'),
      ];

      for (const card of containers) {
        if (results.length >= max) break;

        try {
          // ── Elegir el link principal del card ────────────────────────────
          // BUG: querySelector agarra el PRIMER link del card, que puede ser
          // de un accesorio, review o producto relacionado dentro del mismo grid.
          // SOLUCIÓN: iterar todos los links del card, filtrar basura, y elegir
          // el que tiene el aria-label/texto más largo (= nombre del producto).

          const EXCLUDE = ['#tabbed-customerreviews','#tab-','/reviews',
                           '/questions','/compare','javascript:','mailto:'];

          const productLinks = [...card.querySelectorAll('a[href]')].filter(a => {
            const h = a.getAttribute('href') || '';
            if (EXCLUDE.some(p => h.includes(p))) return false;
            return h.includes('/product/') || h.includes('/site/') || h.includes('skuId');
          });

          if (!productLinks.length) continue;

          // El link con el aria-label/texto más largo es el producto principal,
          // no un accesorio o link "Compare" que tienen texto corto o vacío
          let bestLink = productLinks[0];
          let bestLen  = 0;
          for (const a of productLinks) {
            const label = (a.getAttribute('aria-label') || a.textContent || '').trim();
            if (label.length > bestLen) { bestLen = label.length; bestLink = a; }
          }

          const rawHref    = bestLink.getAttribute('href') || '';
          const productUrl = (rawHref.startsWith('http')
            ? rawHref : 'https://www.bestbuy.com' + rawHref)
            .split('?')[0].split('#')[0];

          if (!productUrl.includes('bestbuy.com')) continue;
          if (seen.has(productUrl)) continue;
          seen.add(productUrl);

          // ── Nombre del MISMO link elegido ────────────────────────────────
          // aria-label > único h4 del card > texto del link
          // Si hay >1 h4 el card tiene múltiples productos → usar el link.
          const linkLabel = (bestLink.getAttribute('aria-label') || bestLink.textContent || '').trim();
          const h4s       = card.querySelectorAll('h4, h3');
          const cardH4    = h4s.length === 1 ? h4s[0].textContent?.trim() : '';
          const name      = (linkLabel.length > 8 ? linkLabel : (cardH4 || linkLabel)).slice(0, 200);
          if (name.length < 4) continue;

          // ── SKU desde la URL del link elegido ────────────────────────────
          const skuFromQuery  = rawHref.match(/skuId=(\d{5,8})/)?.[1];
          const skuFromPath   = rawHref.match(/\/sku\/(\d{5,8})/)?.[1];
          const alphaFromPath = rawHref.match(/\/product\/[^/]+\/([A-Z0-9]{6,12})$/)?.[1];
          const sku = skuFromQuery || skuFromPath || alphaFromPath || '';

          // ── Precio DENTRO del card ────────────────────────────────────────
          // Inspector detectó que selectores globales capturan filtros laterales.
          // Buscar precio solo dentro de este card específico.
          const priceSelectors = [
            '[data-testid="customer-price"] [aria-hidden="true"]',
            '[data-testid="customer-price"] span',
            '.priceView-customer-price [aria-hidden="true"]',
            '[class*="CustomerPrice"] span[aria-hidden="true"]',
            '[class*="priceView"] [aria-hidden="true"]',
            '[class*="Price"][class*="current"] span',
            '[class*="price-current"]',
          ];

          let currentPrice = null;
          for (const sel of priceSelectors) {
            const el   = card.querySelector(sel);
            const text = el?.textContent?.trim();
            if (!text) continue;
            const num = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (num > 0.5 && num < 50000) { currentPrice = num; break; }
          }

          // ── Fallback: regex sobre el texto completo del card ─────────────
          // Si los selectores CSS no encontraron precio (BB cambia clases frecuentemente),
          // buscar con regex cualquier patrón "$NNN.NN" dentro del texto del card.
          // _LOG_ también el texto para diagnóstico cuando precio = null.
          if (!currentPrice) {
            const cardText = card.innerText || card.textContent || '';

            // Log temporal para diagnóstico — ver cómo BB representa el precio
            // Eliminar este log una vez confirmados los selectores correctos
            if (typeof window.__bbPriceDebug === 'undefined') {
              window.__bbPriceDebug = true; // solo loguear una vez por página
              // Devolvemos el texto para que Playwright lo loguee en Node
              card._debugText = cardText.slice(0, 600);
            }

            // Regex: captura "$999", "$1,299.99", "$99.99" — el primero que aparezca
            // en el texto del card (excluye filtros laterales que están fuera del card)
            const priceMatches = cardText.match(/\$\s*([\d,]+(?:\.\d{2})?)/g);
            if (priceMatches) {
              for (const match of priceMatches) {
                const num = parseFloat(match.replace(/[^0-9.]/g, ''));
                if (num > 0.5 && num < 50000) {
                  currentPrice = num;
                  break;
                }
              }
            }
          }

          // Precio regular (tachado)
          const regularSelectors = [
            '[data-testid="regular-price"] [aria-hidden="true"]',
            '[data-testid="regular-price"] span',
            '.priceView-was-price [aria-hidden="true"]',
            '[class*="WasPrice"] span',
            '[class*="was-price"] span',
            'span[class*="strike"]',
            'del span',
          ];

          let regularPrice = null;
          for (const sel of regularSelectors) {
            const el   = card.querySelector(sel);
            const text = el?.textContent?.trim();
            if (!text) continue;
            const num = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (num > currentPrice) { regularPrice = num; break; }
          }

          // Fallback: Best Buy muestra el precio anterior como:
          // "The price was $1,499.99" o en líneas separadas.
          if (!regularPrice && currentPrice) {
            const cardText = card.innerText || card.textContent || '';

            const wasMatch = cardText.match(/The price was\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
            if (wasMatch) {
              const num = parseFloat(wasMatch[1].replace(/,/g, ''));
              if (num > currentPrice) regularPrice = num;
            }

            if (!regularPrice) {
              const saveMatch = cardText.match(/Save\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
              if (saveMatch) {
                const saveAmount = parseFloat(saveMatch[1].replace(/,/g, ''));
                const num = currentPrice + saveAmount;
                if (num > currentPrice) regularPrice = num;
              }
            }
          }

          // ── Imagen ───────────────────────────────────────────────────────
          const imgEl   = card.querySelector('img');
          const imageUrl = imgEl?.src?.startsWith('http') ? imgEl.src : (imgEl?.dataset?.src || null);

          // ── Stock ────────────────────────────────────────────────────────
          const addBtn  = card.querySelector('button[data-button-state="ADD_TO_CART"], button[data-testid*="add-to-cart"]');
          const inStock = Boolean(addBtn) || !card.textContent?.toLowerCase().includes('sold out');

          // ── Clearance ────────────────────────────────────────────────────
          const clearance = card.textContent?.toLowerCase().includes('clearance') ?? false;

          results.push({
            name:         name.slice(0, 200),
            sku,
            currentPrice,
            regularPrice: regularPrice && regularPrice > (currentPrice || 0) ? regularPrice : null,
            imageUrl,
            productUrl,
            inStock,
            clearance,
            source: 'bestbuy_product_card',
            _debugText: (card.innerText || card.textContent || '').slice(0, 1200),
          });
        } catch {}
      }

      return results;
    }, maxCards);

    if (extracted.length) {
      // Log por card para validar asociación nombre↔URL↔precio
      extracted.forEach((c, i) => {
        logger.info(`[Discovery:BB]   [${i}] "${c.name?.slice(0,60)}" | $${c.currentPrice ?? 'NO PRICE'} | ${c.productUrl?.slice(0,80)}`);
      });

      const debugCards = extracted.filter(c => c.currentPrice && c._debugText);
      if (debugCards.length) {
        logger.info(`[Discovery:BB]   Texto del primer card CON precio:`);
        console.log('\n\n===== BB CARD TEXT START =====\n');
        console.log(debugCards[0]._debugText);
        console.log('\n===== BB CARD TEXT END =====\n\n');
      }
      extracted.forEach(c => delete c._debugText);
      logger.info(`[Discovery:BB]   Extracted ${extracted.length} cards (${extracted.filter(c => c.currentPrice).length} with price)`);
      cards.push(...extracted);
    }

    // ── Fallback: cualquier link /product/ o skuId si el extractor de cards no encontró nada ──
    if (!cards.length) {
      logger.info('[Discovery:BB]   Fallback: extrayendo todos los links de producto...');

      const linkCards = await page.evaluate((max) => {
        const seen = new Set();
        const out  = [];

        const allLinks = [
          ...document.querySelectorAll('a[href*="/product/"]'),
          ...document.querySelectorAll('a[href*="skuId"]'),
          ...document.querySelectorAll('a[href*="/site/"][href*=".p"]'),
        ];

        for (const a of allLinks) {
          if (out.length >= max) break;
          const rawHref = a.getAttribute('href') || '';
          if (!rawHref) continue;

          const abs = rawHref.startsWith('http') ? rawHref : 'https://www.bestbuy.com' + rawHref;
          const productUrl = abs.split('?')[0];
          if (!productUrl.includes('bestbuy.com')) continue;
          if (seen.has(productUrl)) continue;
          seen.add(productUrl);

          const skuFromQuery  = rawHref.match(/skuId=(\d{5,8})/)?.[1];
          const skuFromPath   = rawHref.match(/\/sku\/(\d{5,8})/)?.[1];
          const alphaFromPath = rawHref.match(/\/product\/[^/]+\/([A-Z0-9]{6,12})$/)?.[1];
          const sku = skuFromQuery || skuFromPath || alphaFromPath || '';

          const card = a.closest('[data-testid*="product"], [class*="grid-item"], li, article');

          const cardText = card?.innerText || card?.textContent || '';

          let name =
            a.getAttribute('aria-label')?.trim() ||
            a.closest('li, article, div')?.querySelector('h4, h3, a[href*="/product/"], a[href*="/site/"]')?.textContent?.trim() ||
            a.textContent?.trim() ||
            '';

          name = name.replace(/\s+/g, ' ').trim();

          if (
            name.length < 20 ||
            /rating|review|not yet reviewed|stars|sponsored/i.test(name)
          ) {
            const titleFromCard =
              card?.querySelector('h4, h3, [class*="sku-title"], [class*="product-title"]')?.textContent?.trim() ||
              cardText.split('\n').find(line =>
                line.length > 30 &&
                !/rating|review|stars|sponsored|\$|save|price/i.test(line)
              ) ||
              '';

            name = titleFromCard.replace(/\s+/g, ' ').trim();

            if (name.length < 20 || /rating|review|stars|sponsored/i.test(name)) continue;
          }

          // Precio dentro del card padre
          let currentPrice = null;
          let regularPrice = null;
          if (card) {
            const priceEl = card.querySelector('[data-testid*="price"] span, [class*="Price"] span[aria-hidden="true"]');
            const num = parseFloat(priceEl?.textContent?.replace(/[^0-9.]/g, '') || '');
            if (num > 0.5 && num < 50000) currentPrice = num;
          }

          if (card && currentPrice) {
            const txt = card.innerText || card.textContent || '';

            const wasMatch = txt.match(/The price was\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
            if (wasMatch) {
              const num = parseFloat(wasMatch[1].replace(/,/g, ''));
              if (num > currentPrice) regularPrice = num;
            }

            if (!regularPrice) {
              const saveMatch = txt.match(/Save\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
              if (saveMatch) {
                const saveAmount = parseFloat(saveMatch[1].replace(/,/g, ''));
                const num = currentPrice + saveAmount;
                if (num > currentPrice) regularPrice = num;
              }
            }
          }

          out.push({
            name:         name.slice(0, 200),
            sku,
            currentPrice,
            regularPrice,
            productUrl,
            source: 'bestbuy_link_fallback',
          });
        }
        return out;
      }, maxCards);

      if (linkCards.length) {
        logger.info(`[Discovery:BB]   Link fallback: ${linkCards.length} encontrados`);
        cards.push(...linkCards);
      }
    }

    logger.info(`[Discovery:BB]   Total: ${cards.length} cards para "${keyword}" (${cards.filter(c => c.currentPrice).length} con precio)`);

  } catch (err) {
    logger.error(`[Discovery:BB]   Error en "${keyword}": ${err.message}`);
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }

  return cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedup: filtrar cards cuya product_url ya existe en DB
// ─────────────────────────────────────────────────────────────────────────────
async function filterNewCards(cards) {
  if (!cards.length) return [];

  const urls     = cards.map(c => c.productUrl).filter(Boolean);
  if (!urls.length) return cards;

  const existing = await query(
    `SELECT product_url FROM products WHERE product_url = ANY($1::text[])`,
    [urls]
  );
  const existingSet = new Set(existing.rows.map(r => r.product_url));

  const newCards = cards.filter(c => !c.productUrl || !existingSet.has(c.productUrl));
  logger.info(`[Discovery:BB] Dedup: ${cards.length} → ${existingSet.size} en DB → ${newCards.length} nuevos`);
  return newCards;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardar un card directamente en products + prices + deals
// SIN abrir la página del producto
// ─────────────────────────────────────────────────────────────────────────────
async function saveCard(card, storeId) {
  let { name, brand, sku, currentPrice, regularPrice, imageUrl, productUrl, inStock, clearance } = card;

  if (productUrl) {
    productUrl = productUrl.split('#')[0].split('?')[0].replace(/\/$/, '');
  }

  if (!currentPrice || currentPrice < 0.5) return 'no_price';

  const refurbished = /refurbished|renewed|open box|geek squad certified/i.test(name || '');
  const inflatedCompValue = regularPrice && currentPrice && regularPrice > currentPrice * 3;

  if (refurbished && inflatedCompValue) {
    logger.warn(`[Discovery:BB] SKIP inflated comp value: "${name}" | current=$${currentPrice} regular=$${regularPrice}`);
    return 'inflated_comp_value';
  }

  if (!regularPrice || regularPrice <= currentPrice) {
    logger.warn(`[Discovery:BB] SKIP no real discount: "${name}" | current=$${currentPrice} regular=${regularPrice}`);
    return 'no_price';
  }

  try {
    // ── Upsert product ───────────────────────────────────────────────────────
    const catRes = await query(
      `SELECT id FROM categories WHERE slug = 'electronics' LIMIT 1`
    );
    const catId = catRes.rows[0]?.id || null;

    // Check by product_url first to avoid bb-disc-<timestamp> duplicates
    // when the same URL appears without a parseable SKU
    let existingByUrl = null;
    if (productUrl) {
      const urlRes = await query(
        `SELECT id, category_id, (SELECT slug FROM categories WHERE id=products.category_id) AS cat_slug
         FROM products WHERE product_url = $1 AND store_id = $2 LIMIT 1`,
        [productUrl, storeId]
      );
      existingByUrl = urlRes.rows[0] || null;
    }

    let dbProduct = existingByUrl;

    if (!dbProduct) {
      const productRes = await query(`
        INSERT INTO products
          (name, brand, sku, bestbuy_sku, bestbuy_sku_valid, store_id, category_id, image_url, product_url, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        ON CONFLICT (sku, store_id) DO UPDATE SET
          name        = COALESCE(EXCLUDED.name, products.name),
          brand       = COALESCE(EXCLUDED.brand, products.brand),
          image_url   = COALESCE(EXCLUDED.image_url, products.image_url),
          product_url = COALESCE(EXCLUDED.product_url, products.product_url),
          updated_at  = NOW()
        RETURNING id, category_id,
          (SELECT slug FROM categories WHERE id = products.category_id) as cat_slug
      `, [
        name || `Best Buy Product ${sku}`,
        brand || null,
        sku   || productUrl || `bb-disc-${productUrl?.slice(-20) || Date.now()}`,
        /^\d{5,8}$/.test(sku) ? sku : null,
        /^\d{5,8}$/.test(sku) ? true : null,
        storeId,
        catId,
        imageUrl   || null,
        productUrl || null,
      ]);
      dbProduct = productRes.rows[0];
    }

    if (!dbProduct) return 'db_error';

    // ── Construir objeto scraped compatible con saveProductData ───────────────
    // regularPrice es el precio real extraído del card (precio tachado/MSRP).
    // Si no existe en el card, guardamos NULL — NO inventamos un % de descuento.
    const realRegular   = (regularPrice && regularPrice > currentPrice) ? regularPrice : null;
    const discountPct   = realRegular
      ? Math.round(((realRegular - currentPrice) / realRegular) * 100)
      : null;

    const scraped = {
      name,
      brand,
      currentPrice,
      regularPrice:    realRegular,     // null si no había precio tachado
      discountPercent: discountPct,     // null si no hay descuento real
      inStock:         Boolean(inStock),
      imageUrl:        imageUrl || null,
      productUrl:      productUrl || null,
      clearance:       Boolean(clearance),
      pageText:        clearance ? 'clearance' : '',
      source:          card.source || 'bestbuy_search_card',
      data_source:     'live',
    };

    await saveProductData(
      {
        ...dbProduct,
        name,
        brand,
        sku,
        image_url: imageUrl || null,
        product_url: productUrl || null,
        cat_slug: dbProduct.cat_slug || 'electronics',
      },
      scraped,
      STORE_SLUG
    );

    logger.info(`[Discovery:BB] ✅ "${name}" | $${currentPrice} | ${card.source}`);
    return 'saved';

  } catch (err) {
    logger.error(`[Discovery:BB] Error guardando "${name}": ${err.message}`);
    return 'error';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
async function runBestBuyDiscovery(options = {}) {
  const startedAt    = Date.now();
  const maxPerSearch = options.maxPerSearch || options.maxPerPage || parseInt(process.env.BB_DISCOVERY_MAX_PER_SEARCH) || 20;
  const maxTotal     = options.maxTotal    || parseInt(process.env.BB_DISCOVERY_MAX_TOTAL)      || 60;
  const delayMs      = options.delayMs     || parseInt(process.env.BB_DISCOVERY_DELAY_MS)       || 3000;
  // Rotate keyword GROUP each 30-min cycle: each cycle runs a different category
  const cycleNum   = Math.floor(Date.now() / (30 * 60 * 1000));
  let keywords;
  if (options.keywords) {
    keywords = options.keywords;
  } else {
    const groupKeys  = Object.keys(BB_KEYWORD_GROUPS);
    const groupKey   = groupKeys[cycleNum % groupKeys.length];
    keywords         = BB_KEYWORD_GROUPS[groupKey];
    logger.info(`   group="${groupKey}" (cycle #${cycleNum})`);
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info('🟦 BEST BUY DISCOVERY — Search Cards (no product pages)');
  logger.info(`   keywords=${keywords.length}  maxPerSearch=${maxPerSearch}  maxTotal=${maxTotal}`);
  logger.info('═'.repeat(60));

  const stats = {
    searches_run:    0,
    cards_found:     0,
    cards_new:       0,
    saved:           0,
    no_price:        0,
    errors:          0,
  };

  // Obtener storeId de Best Buy
  const storeRes = await query(`SELECT id FROM stores WHERE slug = 'best-buy' LIMIT 1`);
  if (!storeRes.rows[0]) {
    logger.error('[Discovery:BB] Store "best-buy" no encontrada en DB. Ejecuta seed primero.');
    return stats;
  }
  const storeId = storeRes.rows[0].id;

  // ── Fase 1: recolectar cards desde search pages ──────────────────────────
  const allCards = [];

  for (const { label, kw } of keywords) {
    if (allCards.length >= maxTotal * 2) break;

    logger.info(`\n[Discovery:BB] ── Keyword: "${label}"`);

    const cards = await extractCardsFromSearchPage(kw, maxPerSearch);
    stats.searches_run++;
    stats.cards_found += cards.length;
    allCards.push(...cards);

    await sleep(2500);
  }

  if (!allCards.length) {
    logger.warn('[Discovery:BB] 0 cards encontrados. Revisar si searchpage.jsp sigue funcionando.');
    return stats;
  }

  // ── Fase 2: dedup ─────────────────────────────────────────────────────────
  // Dedup interno (misma URL en keywords distintas)
  const seen      = new Set();
  const uniqueAll = allCards.filter(c => {
    const key = c.productUrl || `${c.sku}-${c.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const newCards   = await filterNewCards(uniqueAll);
  stats.cards_new  = newCards.length;
  const toProcess  = newCards.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info('[Discovery:BB] Todos los cards ya están en DB.');
    return stats;
  }

  logger.info(`\n[Discovery:BB] Guardando ${toProcess.length} cards nuevos...`);

  // ── Fase 3: guardar directamente en DB ────────────────────────────────────
  for (let i = 0; i < toProcess.length; i++) {
    const card   = toProcess[i];
    const result = await saveCard(card, storeId);

    if (result === 'saved')    stats.saved++;
    if (result === 'no_price') stats.no_price++;
    if (result === 'error')    stats.errors++;

    if (i < toProcess.length - 1) await sleep(delayMs);
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  logger.info('\n' + '═'.repeat(60));
  logger.info('🟦 BEST BUY DISCOVERY — COMPLETE');
  logger.info(`   searches_run:${stats.searches_run} | cards_found:${stats.cards_found} | cards_new:${stats.cards_new} | saved:${stats.saved} | errors:${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun('best-buy', startedAt, {
    pages_visited: stats.searches_run,
    urls_discovered: stats.cards_found,
    urls_new: stats.cards_new,
    saved: stats.saved,
    errors: stats.errors,
    blocked: false,
  });
  return stats;
}

module.exports = { runBestBuyDiscovery, runDiscovery: runBestBuyDiscovery, extractCardsFromSearchPage, SEARCH_KEYWORDS };

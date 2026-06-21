/**
 * Macy's Discovery Engine — SPA Interception Approach
 *
 * Macy's homepage loads without proxy (Akamai passes plain Chromium).
 * SPA-navigating to sale/clearance sections via pushState triggers React
 * to call xapi/digital/v1/product/{id} for each visible product.
 * We intercept those requests, collect product IDs, then fetch full pricing
 * for new products and save them directly — no separate re-scrape needed.
 *
 * Cycle rotation mirrors BB/Target pattern:
 *   cycleNum = Math.floor(Date.now() / 30min)
 *   groupKey = SALE_GROUPS keys[cycleNum % keys.length]
 */

const { saveDiscoveryCard, sleep } = require('./baseRetailerDiscovery');
const { shouldSkipStore } = require('../proxyManager');
const { writeStoreRun } = require('../../utils/storeRunStats');
const logger = require('../../utils/logger');

const STORE_SLUG  = 'macys';
const STORE_LABEL = "Macy's";
const BASE_URL    = 'https://www.macys.com';

// Each group = list of {label, path} pages to SPA-navigate
const SALE_GROUPS = {
  sale_main:  [{ label: 'sale-main',   path: '/shop/sale?id=3536' }],
  last_act:   [{ label: 'last-act',    path: '/shop/sale/last-act?id=33490' }],
  clearance:  [{ label: 'clearance',   path: '/shop/sale/clearance' }],
  home:       [{ label: 'home-sale',   path: '/shop/sale/home-sale' }],
  womens:     [{ label: 'womens-sale', path: '/shop/sale/womens-sale' }],
  mens:       [{ label: 'mens-sale',   path: '/shop/sale/mens-sale' }],
};

// ─── Pricing parser (mirrors macys.js scraper) ────────────────────────────────
function parsePricing(pricing) {
  const tiers    = pricing?.tieredPrice || [];
  const regTier  = tiers.find(t => t.values?.[0]?.type === 'regular');
  const saleTier = tiers.find(t => t.values?.[0]?.type === 'discount');
  const regularPrice  = regTier?.values?.[0]?.value  ?? null;
  const salePrice     = saleTier?.values?.[0]?.value ?? null;
  const discountPct   = saleTier?.values?.[0]?.percentOff?.[0] ?? null;
  const currentPrice  = salePrice ?? regularPrice;
  const priceTypeText = (pricing?.priceType?.text || '').toLowerCase();
  const clearance = priceTypeText.includes('clearance') || priceTypeText.includes('last act');
  return { currentPrice, regularPrice, discountPct, clearance };
}

// ─── Session management ───────────────────────────────────────────────────────
// One session per discovery run — closed at end of runMacysDiscovery.
async function createSession() {
  logger.info(`[Discovery:${STORE_LABEL}] Launching browser on homepage...`);

  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  chromium.use(stealth());

  const browser = await chromium.launch({
    headless: process.env.NODE_ENV !== 'development',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:   { width: 1440, height: 900 },
    locale:     'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  const page = await ctx.newPage();

  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const title = await page.title().catch(() => '');
  if (/access denied/i.test(title)) {
    await browser.close().catch(() => {});
    throw new Error(`Homepage Akamai block: "${title}"`);
  }

  logger.info(`[Discovery:${STORE_LABEL}] Session ready: "${title}"`);
  return { browser, page };
}

// ─── Category guesser ─────────────────────────────────────────────────────────
// xapi returns empty taxonomy, so infer category from product name keywords.
function guessMacysCategory(name = '') {
  const n = name.toLowerCase();
  if (/sandal|sneaker|\bboot\b|heel|mule|loafer|oxford|pump|\bflat\b|slipper|clog/.test(n)) return 'shoes';
  if (/\bbag\b|tote|crossbody|wallet|purse|carryall|clutch|backpack|satchel/.test(n)) return 'handbags';
  if (/sofa|sectional|chaise|ottoman|couch|mattress|bedding|pillow|rug|curtain|lamp|comforter/.test(n)) return 'home-decor';
  if (/dutch oven|french oven|cookware|stand mixer|kitchenaid|le creuset|skillet|\bpan\b|bakeware/.test(n)) return 'kitchen';
  if (/perfume|fragrance|eau de|cologne|foundation|mascara|serum|moisturizer|skincare|makeup|blush|eyeshadow|cushion foundation/.test(n)) return 'health-beauty';
  if (/ring|necklace|earring|bracelet|\bwatch\b|pendant|chain|brooch/.test(n)) return 'jewelry';
  if (/pokemon|zygarde|pikachu|trading card|collection box|\btoy\b|board game/.test(n)) return 'toys';
  if (/top|shirt|shorts|pants|dress|blouse|sweater|suit|polo|bra|jeans|rompers|hoodie|cardigan|undershirt|skirt|coat|jacket|vest/.test(n)) return 'clothing';
  return 'clothing'; // Macy's default — mostly apparel
}

// ─── URL helper ───────────────────────────────────────────────────────────────
// Format: /shop/product/{brand-name-slug}?ID={id}
// Confirmed via xapi identifier.productUrl — slug = brand + name, ID is query param
function buildProductUrl(productId, name, brand) {
  const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const brandSlug = slugify(brand);
  const nameSlug  = slugify(name).slice(0, 100);
  const slug = (brandSlug ? `${brandSlug}-${nameSlug}` : nameSlug) || 'product';
  return `${BASE_URL}/shop/product/${slug}?ID=${productId}`;
}

// ─── SPA interception ─────────────────────────────────────────────────────────
async function collectProductIds(page, path, label) {
  const productIds = new Set();

  const interceptor = req => {
    const m = req.url().match(/xapi\/digital\/v1\/product\/(\d+)/);
    if (m) productIds.add(m[1]);
  };
  page.on('request', interceptor);

  try {
    // SPA route push — triggers React to fetch products for the sale category
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, path).catch(() => {});

    // Wait for React's initial product fetches
    await sleep(8000);

    // Scroll to trigger lazy loading — React fetches more products as user scrolls
    await page.evaluate(async () => {
      for (let i = 1; i <= 5; i++) {
        window.scrollTo(0, Math.floor((document.body.scrollHeight / 5) * i));
        await new Promise(r => setTimeout(r, 700));
      }
    }).catch(() => {});
    await sleep(3000);

  } finally {
    page.removeListener('request', interceptor);
  }

  logger.info(`[Discovery:${STORE_LABEL}] "${label}": ${productIds.size} product IDs intercepted`);
  return [...productIds];
}

// ─── xapi product fetch ───────────────────────────────────────────────────────
async function fetchProductData(page, productId) {
  const path = `/xapi/digital/v1/product/${productId}?clientId=PROS&currencyCode=USD&_regionCode=US`;

  const result = await page.evaluate(async (apiPath) => {
    try {
      const resp = await fetch(apiPath, {
        headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      });
      return { status: resp.status, data: resp.ok ? await resp.json().catch(() => null) : null };
    } catch (e) { return { status: 0, data: null }; }
  }, path);

  if (!result?.data?.product?.[0]) return null;

  const p       = result.data.product[0];
  const pricing = p.pricing?.price;
  const { currentPrice, regularPrice, discountPct, clearance } = parsePricing(pricing);
  if (!currentPrice) return null;

  const name      = p.detail?.name || '';
  const id        = String(p.identifier?.productId || productId);
  const brand     = p.detail?.brand?.name || null;
  const imageFile = p.imagery?.images?.[0]?.filePath;
  // Use canonical URL from xapi if available, otherwise build it.
  // xapi productUrl returns /shop/product/slug WITHOUT ?ID= — always append it.
  let canonicalUrl = p.identifier?.productUrl
    ? `${BASE_URL}${p.identifier.productUrl}`
    : buildProductUrl(id, name, brand);
  if (!canonicalUrl.includes('?ID=') && !canonicalUrl.includes('&ID=')) {
    canonicalUrl += (canonicalUrl.includes('?') ? '&' : '?') + 'ID=' + id;
  }

  return {
    name,
    brand,
    sku:             id,
    currentPrice,
    regularPrice:    regularPrice || null,
    discountPercent: discountPct ?? (regularPrice ? Math.round((1 - currentPrice / regularPrice) * 100) : 0),
    inStock:         p.availability?.available ?? true,
    imageUrl:        imageFile
      ? `https://slimages.macysassets.com/is/image/MCY/products/${imageFile}?wid=500`
      : null,
    productUrl:      canonicalUrl,
    clearance,
    pageText:        clearance ? 'clearance' : '',
    categorySlug:    guessMacysCategory(name),
    source:          'macys_discovery',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function runMacysDiscovery(options = {}) {
  const startedAt = Date.now();
  const maxTotal = options.maxTotal || 120;
  const delayMs  = options.delayMs  || 800;

  const stats = {
    store: STORE_SLUG,
    group: null,
    groups_visited: 0,
    ids_discovered: 0,
    ids_new: 0,
    saved: 0,
    no_price: 0,
    errors: 0,
    blocked: false,
    blockType: null,
  };

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    stats.blocked   = true;
    stats.blockType = 'skipped_due_to_failures';
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY (SPA interception)`);
  logger.info('═'.repeat(60));

  // Cycle-based group rotation (same pattern as BB/Target)
  const cycleNum  = Math.floor(Date.now() / (30 * 60 * 1000));
  const groupKeys = Object.keys(SALE_GROUPS);
  const groupKey  = groupKeys[cycleNum % groupKeys.length];
  const pages     = options.pages || SALE_GROUPS[groupKey];
  stats.group     = groupKey;
  logger.info(`   group="${groupKey}" (cycle #${cycleNum})  pages=${pages.length}`);

  let session = null;
  try {
    session = await createSession();

    // ── Phase 1: intercept product IDs via SPA navigation ──────────────────
    const allIds = [];
    for (const p of pages) {
      if (allIds.length >= maxTotal * 4) break;
      const ids = await collectProductIds(session.page, p.path, p.label).catch(err => {
        logger.warn(`[Discovery:${STORE_LABEL}] "${p.label}" intercept error: ${err.message}`);
        return [];
      });
      allIds.push(...ids);
      stats.groups_visited++;
      await sleep(1000);
    }

    const uniqueIds      = [...new Set(allIds)];
    stats.ids_discovered = uniqueIds.length;

    if (!uniqueIds.length) {
      logger.warn(`[Discovery:${STORE_LABEL}] No product IDs intercepted`);
      return stats;
    }

    // ── Phase 2: dedup against DB by SKU (numeric product ID) ───────────────
    // URL-based dedup fails because discovery builds URLs without names
    // (e.g. /shop/product/product/ID/123) but DB stores named URLs
    // (e.g. /shop/product/name-slug/ID/123) — they never match.
    const { query: dbQuery } = require('../../config/database');
    const existsRes = await dbQuery(
      `SELECT p.sku FROM products p
       JOIN stores s ON p.store_id = s.id
       WHERE s.slug = $1 AND p.sku = ANY($2::text[])`,
      [STORE_SLUG, uniqueIds]
    );
    const existingSkus = new Set(existsRes.rows.map(r => r.sku));
    const newIds = uniqueIds.filter(id => !existingSkus.has(id));
    stats.ids_new = newIds.length;
    logger.info(`[Discovery:${STORE_LABEL}] Dedup: ${uniqueIds.length} found → ${existingSkus.size} in DB → ${newIds.length} new`);

    const toProcess = newIds.slice(0, maxTotal);
    if (!toProcess.length) {
      logger.info(`[Discovery:${STORE_LABEL}] All discovered products already in DB`);
      return stats;
    }

    logger.info(`[Discovery:${STORE_LABEL}] Fetching ${toProcess.length} new products via xapi...`);

    // ── Phase 3: fetch xapi + save ────────────────────────────────────────
    for (let i = 0; i < toProcess.length; i++) {
      const productId = toProcess[i];
      logger.info(`[Discovery:${STORE_LABEL}] [${i + 1}/${toProcess.length}] id=${productId}`);
      try {
        const product = await fetchProductData(session.page, productId);
        if (!product?.currentPrice) {
          stats.no_price++;
          continue;
        }
        const r = await saveDiscoveryCard(product, STORE_SLUG);
        if (r) {
          stats.saved++;
          const discStr = product.regularPrice
            ? `${product.discountPercent}% off reg $${product.regularPrice}`
            : 'no reg price';
          logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${product.currentPrice} | ${discStr} | "${product.name}"`);
        } else {
          stats.no_price++;
        }
      } catch (err) {
        stats.errors++;
        logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message}`);
      }
      if (delayMs) await sleep(delayMs);
    }

  } catch (err) {
    const errMsg = (err?.message || String(err) || 'unknown_error').slice(0, 200);
    logger.error(`[Discovery:${STORE_LABEL}] Fatal: ${errMsg}`);
    stats.blocked    = true;
    stats.blockType  = 'fatal_error';
    // Include proxy env var presence so we can diagnose from DB without Render log access
    stats.last_error = JSON.stringify({
      error: errMsg,
      ISP_PROXY_HOST: process.env.ISP_PROXY_HOST ? 'set' : '(not set)',
      ISP_PROXY_PORT: process.env.ISP_PROXY_PORT || '(not set)',
      ISP_PROXY_USER: process.env.ISP_PROXY_USER ? process.env.ISP_PROXY_USER.slice(0, 30) : '(not set)',
      ISP_PROXY_PASS: process.env.ISP_PROXY_PASS ? 'set' : '(not set)',
      PROXY_ENABLED:  process.env.PROXY_ENABLED  || '(not set)',
      PROXY_HOST:     process.env.PROXY_HOST      ? 'set' : '(not set)',
      PROXY_USER:     process.env.PROXY_USER      ? process.env.PROXY_USER.slice(0, 30) : '(not set)',
    });
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }

  // Aliases for runEngine summary line compatibility
  stats.pages_visited   = stats.groups_visited;
  stats.urls_discovered = stats.ids_discovered;
  stats.urls_new        = stats.ids_new;

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   group="${stats.group}" | ids:${stats.ids_discovered} | new:${stats.ids_new} | saved:${stats.saved} | no_price:${stats.no_price} | errors:${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runMacysDiscovery, runDiscovery: runMacysDiscovery };

/**
 * Base Retailer Discovery — shared utilities for all store discovery engines.
 *
 * Every new store discovery should import from here instead of duplicating logic.
 * Covers: block detection, navigation, scrolling, price extraction, dedup, save.
 */

const { query }         = require('../../config/database');
const { saveProductData } = require('../scraperBase');
const { logProxyFailure, clearFailures, shouldSkipStore } = require('../proxyManager');
const logger            = require('../../utils/logger');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Block / bot detection ────────────────────────────────────────────────────

const AKAMAI_PATTERNS    = /akamai|edge.*denied|reference #[0-9a-f.]+|edgesuite/i;
const CAPTCHA_PATTERNS   = /captcha|recaptcha|are you a robot|verify you are human|hcaptcha/i;
const BLOCKED_PATTERNS   = /access denied|403 forbidden|you've been blocked|unusual traffic|bot.*detected/i;

function isBlockedPage(title = '', bodyText = '') {
  const combined = `${title} ${bodyText}`;
  return BLOCKED_PATTERNS.test(combined) || title.toLowerCase().includes('access denied');
}

function detectCaptcha(bodyText = '') {
  return CAPTCHA_PATTERNS.test(bodyText);
}

function detectAkamaiBlock(bodyText = '') {
  return AKAMAI_PATTERNS.test(bodyText);
}

/**
 * Classify the type of block from page content.
 * Returns: 'akamai' | 'captcha' | 'blocked' | 'empty' | null
 */
function classifyBlock(title = '', bodyText = '') {
  if (detectAkamaiBlock(bodyText))  return 'akamai';
  if (detectCaptcha(bodyText))       return 'captcha';
  if (isBlockedPage(title, bodyText)) return 'blocked';
  if (!title && bodyText.length < 100) return 'empty';
  return null;
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

/**
 * Safe page.goto that never throws on timeout — returns { ok, blocked, blockType }.
 */
async function safeGoto(page, url, options = {}) {
  const timeout = options.timeout || 40000;
  const waitUntil = options.waitUntil || 'domcontentloaded';

  try {
    await page.goto(url, { waitUntil, timeout });
  } catch (err) {
    if (err.message.includes('timeout')) {
      return { ok: false, blocked: false, blockType: 'timeout', error: err.message };
    }
    return { ok: false, blocked: false, blockType: 'nav_error', error: err.message };
  }

  const title    = await page.title().catch(() => '');
  const bodyText = await page.$eval('body', el => el.innerText?.slice(0, 600) || '').catch(() => '');
  const blockType = classifyBlock(title, bodyText);

  if (blockType) {
    return { ok: false, blocked: true, blockType, title, bodyText };
  }
  return { ok: true, blocked: false, title, bodyText };
}

/**
 * Scroll page to trigger lazy-load.
 */
async function scrollPage(page, steps = 6, delay = 400) {
  await page.evaluate(async (s, d) => {
    for (let i = 0; i < s; i++) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
      await new Promise(r => setTimeout(r, d));
    }
  }, steps, delay).catch(() => {});
  await sleep(800);
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize a product URL: remove fragment, clean common tracking params.
 * Keeps essential path params only.
 */
function normalizeProductUrl(rawUrl, baseHost = '') {
  if (!rawUrl) return null;
  try {
    const abs = rawUrl.startsWith('http') ? rawUrl : `${baseHost}${rawUrl}`;
    const u   = new URL(abs);
    // Strip all query params — product identity is in path
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return rawUrl.split('?')[0].split('#')[0];
  }
}

// ─── Price helpers ────────────────────────────────────────────────────────────

const PRICE_STRIP_RE = /[^0-9.]/g;

/** Parse "$1,299.99" / "1299.99" / "Was $45.00" → 1299.99 */
function extractPrice(text) {
  if (!text) return null;
  const clean = String(text).replace(PRICE_STRIP_RE, '');
  const n = parseFloat(clean);
  return (!isNaN(n) && n > 0) ? n : null;
}

/** Same as extractPrice but for "regular" / "was" price strings. */
function extractRegularPrice(text) {
  return extractPrice(text);
}

/** Returns discount % (0–100) or 0 if not applicable. */
function calculateDiscount(currentPrice, regularPrice) {
  if (!currentPrice || !regularPrice || regularPrice <= currentPrice) return 0;
  return Math.round(((regularPrice - currentPrice) / regularPrice) * 100 * 10) / 10;
}

// ─── Dedup helpers ────────────────────────────────────────────────────────────

/**
 * Remove duplicate cards by normalized URL.
 */
function dedupeCards(cards) {
  const seen = new Set();
  return cards.filter(c => {
    const key = (c.productUrl || c.url || '').split('?')[0].split('#')[0];
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Filter out URLs already in the products table.
 * Returns array of URLs not yet in DB.
 */
async function filterNewUrls(urls, storeLabel = '') {
  if (!urls.length) return [];
  const res = await query(
    `SELECT product_url FROM products WHERE product_url = ANY($1::text[])`,
    [urls]
  );
  const existing = new Set(res.rows.map(r => r.product_url));
  const fresh = urls.filter(u => !existing.has(u));
  logger.info(`[Discovery:${storeLabel}] Dedup: ${urls.length} found → ${existing.size} in DB → ${fresh.length} new`);
  return fresh;
}

// ─── Save helper ──────────────────────────────────────────────────────────────

/**
 * Save a discovered product card to DB.
 * card should have: { name, brand, sku, currentPrice, regularPrice,
 *                     discountPercent, inStock, imageUrl, productUrl,
 *                     clearance, pageText, source }
 * Returns the saveProductData result or null on error.
 */
async function saveDiscoveryCard(card, storeSlug) {
  if (!card?.currentPrice || !card?.productUrl) return null;

  try {
    // Lookup or create store
    const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [storeSlug]);
    const storeId  = storeRes.rows[0]?.id;
    if (!storeId) { logger.warn(`[Discovery] Unknown store slug: ${storeSlug}`); return null; }

    // Build a short deterministic SKU — VARCHAR(100) constraint.
    // Prefer card.sku (truncated); fall back to a sha1-based hash of the URL.
    let safeSku = (card.sku || '').slice(0, 100);
    if (!safeSku) {
      const crypto = require('crypto');
      const prefix = storeSlug.slice(0, 8);
      const hash   = crypto.createHash('sha1').update(card.productUrl).digest('hex').slice(0, 20);
      safeSku = `${prefix}-${hash}`;
    }

    // Lookup or create product
    let dbProduct = null;
    const existRes = await query(
      `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.product_url=$1 LIMIT 1`,
      [card.productUrl]
    );
    dbProduct = existRes.rows[0] || null;

    if (!dbProduct) {
      // Use card.categorySlug if provided; otherwise default to first category alphabetically
      let catId = null, catSlug = null;
      if (card.categorySlug) {
        const catRes = await query('SELECT id, slug FROM categories WHERE slug=$1 LIMIT 1', [card.categorySlug]);
        if (catRes.rows[0]) { catId = catRes.rows[0].id; catSlug = catRes.rows[0].slug; }
      }
      if (!catId) {
        const catFallback = await query('SELECT id, slug FROM categories ORDER BY name LIMIT 1');
        catId = catFallback.rows[0]?.id || null;
        catSlug = catFallback.rows[0]?.slug || null;
      }
      const inserted = await query(
        `INSERT INTO products (name,brand,sku,store_id,category_id,image_url,product_url,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT (sku,store_id) DO UPDATE SET
           name=EXCLUDED.name, image_url=COALESCE(EXCLUDED.image_url,products.image_url),
           product_url=COALESCE(EXCLUDED.product_url,products.product_url), updated_at=NOW()
         RETURNING *`,
        [
          card.name || `Product ${Date.now()}`,
          card.brand || null,
          safeSku,
          storeId,
          catId,
          card.imageUrl || null,
          card.productUrl,
        ]
      );
      dbProduct = { ...inserted.rows[0], cat_slug: catSlug };
    }

    return await saveProductData(dbProduct, card, storeSlug);
  } catch (err) {
    logger.error(`[Discovery:${storeSlug}] saveDiscoveryCard error: ${err.message}`);
    return null;
  }
}

// ─── Block handler ────────────────────────────────────────────────────────────

/**
 * Call this when a page is detected as blocked.
 * Logs the failure, closes the page, and returns a stats object.
 */
async function handleBlock(page, ctx, storeSlug, blockType, url = '') {
  logger.warn(`[Discovery:${storeSlug}] BLOCKED (${blockType}) on ${url}`);
  const shouldSkip = logProxyFailure(storeSlug, 403, blockType);
  await page?.close().catch(() => {});
  await ctx?.close().catch(() => {});
  return { blocked: true, blockType, shouldSkip };
}

// ─── Generic discovery runner ─────────────────────────────────────────────────

/**
 * Full discovery run for a store.
 *
 * @param {object} config
 *   storeSlug     - store slug
 *   storeLabel    - display name
 *   pages         - [{ label, url }]
 *   getContext    - async fn() → Playwright browser context
 *   linkFilter    - fn(href) → bool
 *   cleanUrl      - fn(href) → string (canonical URL)
 *   waitSelector  - CSS to wait for before extracting
 *   maxPerPage    - max URLs per listing page
 *   maxTotal      - total new products to process
 *   delayMs       - delay between product scans
 *   maxConsecutiveEmpty - stop after N empty pages (default 3)
 */
async function runStoreDiscovery(config) {
  const {
    storeSlug,
    storeLabel   = storeSlug,
    pages        = [],
    getContext,
    linkFilter,
    cleanUrl,
    waitSelector = null,
    waitUntil    = 'domcontentloaded',
    maxPerPage   = 30,
    maxTotal     = 150,
    delayMs      = 2000,
    maxConsecutiveEmpty = 3,
  } = config;

  const { scanSingleProduct } = require('../../jobs/scanJob');

  const stats = {
    store: storeSlug, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0, blocked: false, blockType: null,
  };

  // Check if store was recently blocked too many times
  if (shouldSkipStore(storeSlug)) {
    logger.warn(`[Discovery:${storeLabel}] Skipping — too many recent blocks`);
    stats.blocked = true;
    stats.blockType = 'skipped_due_to_failures';
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${storeLabel.toUpperCase()} DISCOVERY`);
  logger.info(`   maxPerPage=${maxPerPage}  maxTotal=${maxTotal}`);
  logger.info('═'.repeat(60));

  // ── Phase 1: collect URLs ─────────────────────────────────────────────────
  const allRaw = [];
  let consecutiveEmpty = 0;

  for (const p of pages) {
    if (allRaw.length >= maxTotal * 3) break;
    if (consecutiveEmpty >= maxConsecutiveEmpty) {
      logger.warn(`[Discovery:${storeLabel}] ${maxConsecutiveEmpty} consecutive empty pages — stopping URL collection`);
      break;
    }

    logger.info(`\n[Discovery:${storeLabel}] ── ${p.label}`);

    const ctx  = await getContext();
    const page = await ctx.newPage();

    try {
      const nav = await safeGoto(page, p.url, { waitUntil });

      if (!nav.ok) {
        if (nav.blocked) {
          const result = await handleBlock(page, ctx, storeSlug, nav.blockType, p.url);
          if (result.shouldSkip) {
            stats.blocked   = true;
            stats.blockType = nav.blockType;
            logger.warn(`[Discovery:${storeLabel}] BLOCKED_BY_AKAMAI — stopping`);
            return stats;
          }
          consecutiveEmpty++;
          stats.pages_visited++;
          continue;
        }
        // timeout or nav error — count as empty but keep trying
        consecutiveEmpty++;
        stats.pages_visited++;
        await page.close().catch(() => {});
        await ctx.close().catch(() => {});
        continue;
      }

      // Clear failure log on successful page load
      clearFailures(storeSlug);

      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: 12000 }).catch(() => {});
      }
      await scrollPage(page);

      // Extract product links — collect ALL hrefs from DOM, filter in Node.js
      // NOTE: do NOT cap collection here; Node-side linkFilter reduces to maxPerPage.
      // A small cap (e.g. maxPerPage=30) would miss product links buried after nav/footer.
      const raw = await page.evaluate(() => {
        const found = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          if (href) found.add(href);
        });
        return [...found];
      }).catch(() => []);

      // Apply filter + clean in Node context
      const filtered = [];
      for (const href of raw) {
        if (!linkFilter || linkFilter(href)) {
          const url = cleanUrl ? cleanUrl(href) : normalizeProductUrl(href);
          if (url) filtered.push(url);
          if (filtered.length >= maxPerPage) break;
        }
      }

      logger.info(`[Discovery:${storeLabel}]   Found ${filtered.length} URLs`);
      allRaw.push(...filtered);

      if (filtered.length === 0) consecutiveEmpty++;
      else consecutiveEmpty = 0;

    } catch (err) {
      logger.error(`[Discovery:${storeLabel}]   Error: ${err.message}`);
      consecutiveEmpty++;
    } finally {
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }

    stats.pages_visited++;
    await sleep(1500);
  }

  stats.urls_discovered = allRaw.length;

  if (!allRaw.length) {
    logger.warn(`[Discovery:${storeLabel}] No URLs extracted`);
    return stats;
  }

  // ── Phase 2: dedup ────────────────────────────────────────────────────────
  const unique  = [...new Set(allRaw)];
  const newUrls = await filterNewUrls(unique, storeLabel);
  stats.urls_new  = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${storeLabel}] All URLs already in DB`);
    return stats;
  }

  logger.info(`\n[Discovery:${storeLabel}] Scanning ${toProcess.length} new products...`);

  // ── Phase 3: scan ─────────────────────────────────────────────────────────
  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 2;

  async function scanOne(url, idx) {
    logger.info(`[Discovery:${storeLabel}] [${idx+1}/${toProcess.length}] ${url}`);
    try {
      const result = await scanSingleProduct(storeSlug, url);
      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        logger.info(`[Discovery:${storeLabel}]   ✅ $${result.currentPrice} | "${result.name || ''}"`);
      } else {
        stats.no_price++;
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${storeLabel}]   ❌ ${err.message}`);
    }
    await sleep(delayMs);
  }

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    await Promise.all(toProcess.slice(i, i + CONCURRENCY).map((url, j) => scanOne(url, i + j)));
  }

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${storeLabel.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   pages: ${stats.pages_visited} | found: ${stats.urls_discovered} | new: ${stats.urls_new} | saved: ${stats.saved} | errors: ${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  return stats;
}

module.exports = {
  safeGoto,
  scrollPage,
  normalizeProductUrl,
  extractPrice,
  extractRegularPrice,
  calculateDiscount,
  dedupeCards,
  filterNewUrls,
  saveDiscoveryCard,
  isBlockedPage,
  detectCaptcha,
  detectAkamaiBlock,
  classifyBlock,
  handleBlock,
  runStoreDiscovery,
  sleep,
};

/**
 * Playwright-based GameStop placeholder enrichment.
 * Fetches real product names for "GameStop Product XXXXX" entries.
 * Cloudflare blocks plain HTTP — Playwright bypasses it.
 *
 * After updating a name, re-classifies quality_status so the product
 * becomes visible immediately (PASS if image exists, NEEDS_IMAGE if not).
 *
 * Run: node scripts/enrich-gamestop-playwright.js [--limit N]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const { Pool } = require('pg');

// GameStop doesn't need Akamai-level proxy — plain Playwright chromium works.
// We build a minimal context directly to avoid the ISP proxy requirement.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _browser = null;
async function getGsBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return _browser;
}

async function newGsContext() {
  const browser = await getGsBrowser();
  return browser.newContext({
    userAgent: UA,
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DELAY_MS = 2000;

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const MAX_PRODUCTS = limitArg >= 0 ? parseInt(args[limitArg + 1]) || 50 : 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const PLACEHOLDER_RE = /^gamestop product[[:space:]]*[0-9]+$/i;

async function fetchProductName(url) {
  const ctx  = await newGsContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const finalUrl = page.url();
    const title    = await page.title().catch(() => '');

    // GameStop title format: "Product Name | GameStop" or "Buy Product Name | GameStop"
    const rawTitle = (title.split('|')[0] || '').trim().replace(/\s+/g, ' ');
    const fromTitle = rawTitle
      .replace(/^(Buy|Shop|Get|Order)\s+/i, '')      // strip leading action words
      .replace(/\s*[-–]\s*(Pre-?Order Now?|Coming Soon|Available Now)$/i, '') // strip page state suffixes
      .trim();
    if (fromTitle.length >= 4 && !/attention required|access denied|gamestop\.com$/i.test(fromTitle)) {
      return { name: fromTitle, finalUrl };
    }

    // h1 fallback
    const h1 = await page.$eval('h1', el => el.textContent?.trim() || '').catch(() => '');
    if (h1.length >= 4 && !/attention required/i.test(h1)) {
      return { name: h1.slice(0, 500), finalUrl };
    }

    // Extract from URL slug if redirected: /products/product-name-slug/XXXXX.html
    const slugMatch = finalUrl.match(/\/products\/([a-z][a-z0-9-]{4,})\/?\d+\.html/i);
    if (slugMatch) {
      const name = slugMatch[1].replace(/-+/g, ' ')
        .replace(/\b(\w)/g, c => c.toUpperCase()).trim();
      if (name.length >= 4) return { name, finalUrl };
    }

    return null;
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

async function reclassify(pool, productId, hasImage) {
  const status = hasImage ? 'PASS' : 'NEEDS_IMAGE';
  const reason = hasImage ? null : 'No image — flagged for enrichment';
  await pool.query(`
    UPDATE products SET
      quality_status        = $2,
      is_public_visible     = TRUE,
      quality_reason        = $3,
      last_quality_check_at = NOW(),
      updated_at            = NOW()
    WHERE id = $1
  `, [productId, status, reason]);
}

async function main() {
  console.log(`=== GameStop Playwright Enrichment (limit=${MAX_PRODUCTS}) ===\n`);

  const res = await pool.query(`
    SELECT p.id, p.name, p.product_url, p.sku, p.image_url
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE s.slug = 'gamestop'
      AND (
        p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
        OR p.name ~* '^product[[:space:]]+[0-9]+$'
        OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
      )
    ORDER BY p.created_at ASC
    LIMIT $1
  `, [MAX_PRODUCTS]);

  const products = res.rows;
  console.log(`Found ${products.length} placeholder products\n`);

  let updated = 0, failed = 0, skipped = 0;

  for (let i = 0; i < products.length; i++) {
    const prod = products[i];
    console.log(`[${i + 1}/${products.length}] ${prod.product_url}`);

    try {
      const result = await fetchProductName(prod.product_url);
      if (!result) {
        console.log(`  ⚠️  no name found`);
        failed++;
        await sleep(DELAY_MS);
        continue;
      }

      const { name, finalUrl } = result;

      await pool.query(
        `UPDATE products SET name=$1, product_url=COALESCE($2, product_url), updated_at=NOW() WHERE id=$3`,
        [name, finalUrl || null, prod.id]
      );
      await reclassify(pool, prod.id, !!(prod.image_url && prod.image_url.trim()));
      console.log(`  ✅ "${name}" — quality_status=${prod.image_url ? 'PASS' : 'NEEDS_IMAGE'}`);
      updated++;
    } catch (err) {
      console.log(`  ❌ ${err.message.slice(0, 80)}`);
      failed++;
    }

    await sleep(DELAY_MS);

    if ((i + 1) % 10 === 0) {
      console.log(`\n  --- Progress: ${updated} updated, ${failed} failed, ${skipped} skipped ---\n`);
    }
  }

  console.log(`\n=== DONE === Updated: ${updated} | Failed: ${failed} | Skipped: ${skipped}`);
  if (_browser) await _browser.close().catch(() => {});
  await pool.end();
}

main().catch(async e => { console.error(e); if (_browser) await _browser.close().catch(() => {}); pool.end(); process.exit(1); });

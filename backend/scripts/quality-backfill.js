#!/usr/bin/env node
/**
 * Feed Quality Backfill
 *
 * Classifies all products and sets quality_status + is_public_visible.
 * Also attempts to enrich up to 20 GameStop placeholder products via HTTP og:title fetch.
 * Also fixes Macy's broken URLs where a numeric SKU is available.
 *
 * Usage:
 *   node scripts/quality-backfill.js            — dry-run (no DB writes)
 *   node scripts/quality-backfill.js --apply    — write changes to DB
 *
 * Rules:
 *   - No BrightData / no Playwright
 *   - Max 20 HTTP fetches per store for enrichment
 *   - No records deleted — only is_public_visible + quality_status updated
 */

const path = require('path');
// Support running from scripts/ or from backend/
process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const axios  = require('axios');
const { pool, query } = require('../src/config/database');
const { classifyProduct } = require('../src/services/feedQuality');

const DRY_RUN = !process.argv.includes('--apply');
const ENRICH_LIMIT = 20; // max HTTP fetches per store

if (DRY_RUN) {
  console.log('[quality-backfill] DRY RUN — no DB writes. Pass --apply to commit.');
} else {
  console.log('[quality-backfill] APPLY mode — writing to DB.');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function dbWrite(sql, params) {
  if (DRY_RUN) return { rowCount: 0 };
  return query(sql, params);
}

/**
 * Fetch og:title from a product page via plain HTTP (no Playwright, no proxy).
 * Returns the cleaned title string, or null on failure.
 */
async function fetchOgTitle(url) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Accept': 'text/html',
      },
      maxRedirects: 5,
    });
    const html = res.data || '';
    // Try og:title first, then <title>
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch) return ogMatch[1].trim();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      return titleMatch[1].trim().replace(/\s*[-|]\s*(GameStop|Macy's).*$/i, '').trim();
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  // Load all products with store info
  const { rows: products } = await query(`
    SELECT
      p.id, p.name, p.product_url, p.image_url, p.sku,
      s.slug AS store_slug, s.name AS store_name
    FROM products p
    JOIN stores s ON p.store_id = s.id
    ORDER BY s.slug, p.id
  `);

  console.log(`\n[quality-backfill] Loaded ${products.length} products\n`);

  const counts = {};
  const issues = [];          // top issues for report
  const toUpdate = [];        // { id, quality_status, quality_reason, is_public_visible, new_name?, new_url? }

  const gsEnrichQueue   = []; // GameStop placeholder IDs to try HTTP enrichment
  const macysFixQueue   = []; // Macy's broken-URL products with numeric SKU to fix

  for (const p of products) {
    const result = classifyProduct(p);
    const storeSlug = p.store_slug;

    counts[storeSlug] = counts[storeSlug] || { total: 0, pass: 0, hidden: 0 };
    counts[storeSlug].total++;

    if (result.visible) {
      counts[storeSlug].pass++;
      // If currently hidden (from a previous run), mark as PASS
      toUpdate.push({ id: p.id, quality_status: 'PASS', quality_reason: null, is_public_visible: true });
    } else {
      counts[storeSlug].hidden++;
      toUpdate.push({ id: p.id, quality_status: result.status, quality_reason: result.reason, is_public_visible: false });
      issues.push({ store: storeSlug, name: p.name, status: result.status, reason: result.reason, url: p.product_url });

      // Queue for enrichment
      if (result.status === 'PLACEHOLDER_TITLE' && storeSlug === 'gamestop' && gsEnrichQueue.length < ENRICH_LIMIT) {
        gsEnrichQueue.push(p);
      }
      if (result.status === 'BROKEN_URL' && storeSlug === 'macys' && /^\d+$/.test(p.sku || '') && macysFixQueue.length < ENRICH_LIMIT) {
        macysFixQueue.push(p);
      }
    }
  }

  // ── Status summary ──────────────────────────────────────────────────────────
  console.log('=== Classification Summary ===');
  let totalHidden = 0;
  for (const [store, c] of Object.entries(counts)) {
    console.log(`  ${store.padEnd(16)} total=${c.total} pass=${c.pass} hide=${c.hidden}`);
    totalHidden += c.hidden;
  }

  const byStatus = {};
  for (const item of issues) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  console.log('\n=== By Status ===');
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s.padEnd(25)} ${n}`);
  console.log(`\nTotal products to hide: ${totalHidden}\n`);

  // ── GameStop enrichment (up to 20 HTTP fetches) ────────────────────────────
  if (gsEnrichQueue.length > 0) {
    console.log(`\n=== GameStop Enrichment (${gsEnrichQueue.length} products) ===`);
    let enriched = 0;
    for (const p of gsEnrichQueue) {
      const title = await fetchOgTitle(p.product_url);
      if (title && title.length >= 5 && !/gamestop product/i.test(title)) {
        console.log(`  ✅ ${p.name} → "${title}"`);
        const idx = toUpdate.findIndex(u => u.id === p.id);
        if (idx >= 0) {
          toUpdate[idx].quality_status     = 'PASS';
          toUpdate[idx].quality_reason     = null;
          toUpdate[idx].is_public_visible  = true;
          toUpdate[idx].new_name           = title;
        }
        enriched++;
      } else {
        console.log(`  ❌ ${p.name} — fetch failed or still placeholder`);
      }
      // Small delay to avoid hammering GameStop
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`\nGameStop enrichment: ${enriched}/${gsEnrichQueue.length} recovered\n`);
  }

  // ── Macy's URL fix (up to 20, numeric SKU → append ?ID=) ──────────────────
  if (macysFixQueue.length > 0) {
    console.log(`\n=== Macy's URL Fix (${macysFixQueue.length} products) ===`);
    let fixed = 0;
    for (const p of macysFixQueue) {
      const fixedUrl = `${p.product_url}?ID=${p.sku}`;
      console.log(`  🔧 ${p.name.slice(0, 50)} → ${fixedUrl.slice(0, 80)}`);
      const idx = toUpdate.findIndex(u => u.id === p.id);
      if (idx >= 0) {
        toUpdate[idx].quality_status     = 'PASS';
        toUpdate[idx].quality_reason     = null;
        toUpdate[idx].is_public_visible  = true;
        toUpdate[idx].new_url            = fixedUrl;
      }
      fixed++;
    }
    console.log(`Macy's URL fix: ${fixed}/${macysFixQueue.length} repaired\n`);
  }

  // ── Top 20 issues (for report) ─────────────────────────────────────────────
  const stillHidden = toUpdate.filter(u => u.is_public_visible === false);
  console.log(`\n=== Top 20 Hidden Products ===`);
  for (const u of stillHidden.slice(0, 20)) {
    const src = issues.find(i => i.url === u.quality_reason || true) || {};
    const match = issues.find(i => toUpdate.find(t => t.id === u.id));
    const issue = issues.find(i => {
      const t = toUpdate.find(t => t.id === u.id);
      return t;
    });
    console.log(`  [${u.quality_status}] id=${u.id} reason=${u.quality_reason}`);
  }

  if (DRY_RUN) {
    console.log('\n[quality-backfill] DRY RUN complete. No changes written.');
    console.log('Run with --apply to commit.');
    await pool.end();
    return;
  }

  // ── Apply updates ──────────────────────────────────────────────────────────
  console.log(`\n[quality-backfill] Applying ${toUpdate.length} updates...`);
  let applied = 0;
  let nameUpdates = 0;
  let urlUpdates = 0;

  for (const u of toUpdate) {
    if (u.new_name && u.new_url) {
      await dbWrite(
        `UPDATE products SET quality_status=$1, quality_reason=$2, is_public_visible=$3, name=$4, product_url=$5, updated_at=NOW() WHERE id=$6`,
        [u.quality_status, u.quality_reason, u.is_public_visible, u.new_name, u.new_url, u.id]
      );
      nameUpdates++; urlUpdates++;
    } else if (u.new_name) {
      await dbWrite(
        `UPDATE products SET quality_status=$1, quality_reason=$2, is_public_visible=$3, name=$4, updated_at=NOW() WHERE id=$5`,
        [u.quality_status, u.quality_reason, u.is_public_visible, u.new_name, u.id]
      );
      nameUpdates++;
    } else if (u.new_url) {
      await dbWrite(
        `UPDATE products SET quality_status=$1, quality_reason=$2, is_public_visible=$3, product_url=$4, updated_at=NOW() WHERE id=$5`,
        [u.quality_status, u.quality_reason, u.is_public_visible, u.new_url, u.id]
      );
      urlUpdates++;
    } else {
      await dbWrite(
        `UPDATE products SET quality_status=$1, quality_reason=$2, is_public_visible=$3, updated_at=NOW() WHERE id=$4`,
        [u.quality_status, u.quality_reason, u.is_public_visible, u.id]
      );
    }
    applied++;
  }

  console.log(`\n[quality-backfill] Done.`);
  console.log(`  products classified : ${applied}`);
  console.log(`  hidden from feed    : ${toUpdate.filter(u => u.is_public_visible === false).length}`);
  console.log(`  names recovered     : ${nameUpdates}`);
  console.log(`  URLs fixed          : ${urlUpdates}`);

  await pool.end();
}

run().catch(err => {
  console.error('[quality-backfill] FATAL:', err.message);
  process.exit(1);
});

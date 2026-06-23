/**
 * Feed Quality Gate — JavaScript-side classifier.
 *
 * Used by Node.js scripts (backfill, enrichment).
 * SQL-side classifier in quality-classify.js is the canonical source for DB updates.
 *
 * Public feed rule:
 *   is_public_visible = true AND quality_status = 'PASS'
 *
 * Status values:
 *   PASS                 — product is complete and linkable
 *   HIDDEN_BROKEN_URL    — URL structurally missing required routing ID
 *   HIDDEN_GENERIC_TITLE — name matches a known stub pattern
 *   HIDDEN_MISSING_TITLE — name is null, empty, or too short
 *   NEEDS_IMAGE          — no image_url; visible but flagged for enrichment
 *   NEEDS_RECOVERY       — has real name but is otherwise incomplete; attempt re-scrape
 *   INCOMPLETE_PRODUCT   — no URL at all
 *   MANUAL_REVIEW        — confidence too low to auto-publish
 */

const PLACEHOLDER_PATTERNS = [
  /^gamestop product\s+\d+$/i,
  /^product\s+\d+$/i,
  /^[a-z]{2,12}\s+product\s+\d+$/i,
  /^\d{5,}$/,
];

/**
 * Classify a product row.
 * @param {object} p — must have: name, product_url, image_url
 * @returns {{ status: string, visible: boolean, reason: string|null }}
 */
function classifyProduct(p) {
  const name = (p.name || '').trim();
  const url  = (p.product_url || '').trim();
  const img  = (p.image_url || '').trim();

  if (!name || name.length < 5) {
    return { status: 'HIDDEN_MISSING_TITLE', visible: false, reason: 'Empty or too-short product name' };
  }

  for (const pat of PLACEHOLDER_PATTERNS) {
    if (pat.test(name)) {
      return { status: 'HIDDEN_GENERIC_TITLE', visible: false, reason: `Placeholder name: "${name}"` };
    }
  }

  if (url.includes('macys.com') && !url.includes('?ID=') && !url.includes('/ID/')) {
    return { status: 'HIDDEN_BROKEN_URL', visible: false, reason: "Macy's URL missing product ID — will 404 in browser" };
  }

  if (!url) {
    return { status: 'INCOMPLETE_PRODUCT', visible: false, reason: 'No product URL' };
  }

  if (!img) {
    return { status: 'NEEDS_IMAGE', visible: true, reason: 'No image — flagged for enrichment' };
  }

  return { status: 'PASS', visible: true, reason: null };
}

/**
 * The SQL WHERE clause for public endpoints.
 * Use this string directly in queries joining products p.
 */
const PUBLIC_QUALITY_FILTER = `(p.is_public_visible = true AND p.quality_status IN ('PASS', 'NEEDS_IMAGE'))`;

module.exports = { classifyProduct, PUBLIC_QUALITY_FILTER, PLACEHOLDER_PATTERNS };

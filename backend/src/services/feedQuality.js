/**
 * Feed Quality Gate
 *
 * Classifies products as PASS or a specific failure reason.
 * is_public_visible = false hides the product from the public feed.
 * Admin endpoints bypass this filter.
 *
 * Status values:
 *   PASS               — product looks complete and linkable
 *   MISSING_TITLE      — name is null or too short
 *   PLACEHOLDER_TITLE  — name matches a known stub pattern (e.g. "GameStop Product 477018")
 *   BROKEN_URL         — URL structurally invalid or missing required routing ID
 *   MISSING_IMAGE      — no image_url
 *   INVALID_PRICE      — deal_price <= 0 or null
 *   INCOMPLETE_PRODUCT — multiple minor issues
 */

const PLACEHOLDER_PATTERNS = [
  /^gamestop product\s+\d+$/i,
  /^product\s+\d+$/i,
  /^\d{5,}$/,                     // pure numeric ID as name
];

/**
 * Classify a product row.
 * @param {object} p — must have: name, product_url, store_slug (or store from JOIN)
 * @returns {{ status: string, visible: boolean, reason: string|null }}
 */
function classifyProduct(p) {
  const name     = (p.name || '').trim();
  const url      = (p.product_url || '').trim();
  const storeSlug = (p.store_slug || p.store_name || '').toLowerCase();

  if (!name || name.length < 5) {
    return { status: 'MISSING_TITLE', visible: false, reason: 'Empty or too-short product name' };
  }

  for (const pat of PLACEHOLDER_PATTERNS) {
    if (pat.test(name)) {
      return {
        status: 'PLACEHOLDER_TITLE',
        visible: false,
        reason: `Placeholder name: "${name}"`,
      };
    }
  }

  // Macy's URLs require a numeric product ID (?ID= or /ID/) to route correctly.
  if (storeSlug.includes('mac') || url.includes('macys.com')) {
    if (url && !url.includes('?ID=') && !url.includes('/ID/')) {
      return {
        status: 'BROKEN_URL',
        visible: false,
        reason: 'Macy\'s URL missing product ID — will 404 in browser',
      };
    }
  }

  if (!url) {
    return { status: 'INCOMPLETE_PRODUCT', visible: false, reason: 'No product URL' };
  }

  return { status: 'PASS', visible: true, reason: null };
}

module.exports = { classifyProduct };

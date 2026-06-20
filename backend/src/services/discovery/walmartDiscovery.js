/**
 * Walmart Discovery Engine — Clearance / Rollback / Deals pages
 *
 * Uses Playwright with residential proxy (newBestBuyContext).
 * Walmart Akamai may block — if all pages return empty, reports blocked.
 *
 * Product URL pattern: walmart.com/ip/{name}/{itemId}
 */

const { runStoreDiscovery }    = require('./baseRetailerDiscovery');
const { newIspContext }        = require('../browserEngine');
const { shouldSkipStore }      = require('../proxyManager');
const { writeStoreRun }        = require('../../utils/storeRunStats');
const logger = require('../../utils/logger');

const STORE_SLUG  = 'walmart';
const STORE_LABEL = 'Walmart';

const DISCOVERY_PAGES = [
  { label: 'clearance',            url: 'https://www.walmart.com/browse/clearance' },
  { label: 'rollback',             url: 'https://www.walmart.com/shop/deals/rollback' },
  { label: 'deals',                url: 'https://www.walmart.com/shop/deals' },
  { label: 'electronics-clearance', url: 'https://www.walmart.com/browse/electronics/clearance/3944_1105910?facet=deal_type:Clearance' },
  { label: 'home-clearance',       url: 'https://www.walmart.com/browse/home/clearance/4044_623679?facet=deal_type:Clearance' },
  { label: 'seasonal-rollback',    url: 'https://www.walmart.com/browse/seasonal/rollback/976759?facet=deal_type:Rollback' },
];

async function runWalmartDiscovery(options = {}) {
  const startedAt = Date.now();

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    const stats = {
      store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
      urls_new: 0, saved: 0, errors: 0, blocked: true,
      blockType: 'skipped_due_to_failures',
    };
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  function linkFilter(href) {
    return !!(href && href.match(/walmart\.com\/ip\/[^/?#]+\/\d+/));
  }
  function cleanUrl(href) {
    const base = href.startsWith('http') ? href : `https://www.walmart.com${href}`;
    return base.split('?')[0].split('#')[0];
  }

  let result;
  try {
    result = await runStoreDiscovery({
      storeSlug:           STORE_SLUG,
      storeLabel:          STORE_LABEL,
      pages:               DISCOVERY_PAGES,
      getContext:          () => newIspContext(),
      linkFilter,
      cleanUrl,
      maxPerPage:          options.maxPerPage || 30,
      maxTotal:            options.maxTotal   || 150,
      delayMs:             options.delayMs    || 2000,
      maxConsecutiveEmpty: 2,
    });
  } catch (err) {
    logger.error(`[Discovery:${STORE_LABEL}] Fatal: ${err.message}`);
    result = {
      store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
      urls_new: 0, saved: 0, errors: 1, blocked: true,
      blockType: 'fatal_error',
    };
  }

  await writeStoreRun(STORE_SLUG, startedAt, result);
  return result;
}

module.exports = { runWalmartDiscovery, runDiscovery: runWalmartDiscovery };

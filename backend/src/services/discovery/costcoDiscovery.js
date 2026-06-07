/**
 * Costco Discovery Engine
 * Costco exposes clearance and hot buys without login.
 * Product URLs: /product/cat/12345.html
 */

const { runDiscovery } = require('./discoveryBase');

const STORE_SLUG  = 'costco';
const STORE_LABEL = 'Costco';

const DISCOVERY_PAGES = [
  { label: 'clearance-all',       url: 'https://www.costco.com/clearance-items.html' },
  { label: 'hot-buys',            url: 'https://www.costco.com/hot-buys.html' },
  { label: 'electronics-deals',   url: 'https://www.costco.com/electronics-deals.html' },
  { label: 'appliance-deals',     url: 'https://www.costco.com/appliances-deals.html' },
  { label: 'clearance-electronics', url: 'https://www.costco.com/ClearanceElectronics.html' },
  { label: 'tv-deals',            url: 'https://www.costco.com/televisions.html' },
  { label: 'laptop-deals',        url: 'https://www.costco.com/laptops.html' },
  { label: 'tablet-deals',        url: 'https://www.costco.com/tablets.html' },
  { label: 'appliance-deals-2',   url: 'https://www.costco.com/major-appliances.html' },
  { label: 'mattress-deals',      url: 'https://www.costco.com/mattresses.html' },
  { label: 'furniture-deals',     url: 'https://www.costco.com/furniture.html' },
  { label: 'tool-deals',          url: 'https://www.costco.com/tools.html' },
  { label: 'vacuum-deals',        url: 'https://www.costco.com/vacuums.html' },
  { label: 'camera-deals',        url: 'https://www.costco.com/cameras.html' },
  { label: 'smart-home',          url: 'https://www.costco.com/smart-home.html' },
];

function linkFilter(href) {
  return href && href.includes('/product/') && href.endsWith('.html') &&
    !/\/category\//.test(href) && !/\/c\//.test(href);
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.costco.com${href}`;
  return base.split('#')[0].split('?')[0];
}

async function runDiscoveryCostco(options = {}) {
  return runDiscovery({
    storeSlug:  STORE_SLUG,
    storeLabel: STORE_LABEL,
    pages:      options.pages || DISCOVERY_PAGES,
    linkFilter,
    cleanUrl,
    waitSelector: '.product-list .product, .product-tile, [class*="product-card"]',
    maxPerPage: options.maxPerPage || 30,
    maxTotal:   options.maxTotal   || 100,
    delayMs:    options.delayMs    || 2500,
  });
}

module.exports = { runDiscovery: runDiscoveryCostco, DISCOVERY_PAGES };

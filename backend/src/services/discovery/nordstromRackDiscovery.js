/**
 * Nordstrom Rack Discovery Engine
 *
 * Nordstrom Rack uses residential proxy. Can be blocked — full Akamai handling.
 * Good for: shoes, clothing, handbags, jewelry at clearance prices.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'nordstrom-rack';
const STORE_LABEL = 'Nordstrom Rack';

const DISCOVERY_PAGES = [
  // Clearance / Sale hubs
  { label: 'clearance-women',       url: 'https://www.nordstromrack.com/sale/women?sortBy=PriceAscending' },
  { label: 'clearance-men',         url: 'https://www.nordstromrack.com/sale/men?sortBy=PriceAscending' },
  { label: 'clearance-kids',        url: 'https://www.nordstromrack.com/sale/kids?sortBy=PriceAscending' },
  { label: 'clearance-home',        url: 'https://www.nordstromrack.com/sale/home?sortBy=PriceAscending' },
  // Shoes (high resale)
  { label: 'shoes-women-sale',      url: 'https://www.nordstromrack.com/sale/women/shoes?sortBy=PriceAscending' },
  { label: 'shoes-men-sale',        url: 'https://www.nordstromrack.com/sale/men/shoes?sortBy=PriceAscending' },
  { label: 'sneakers',              url: 'https://www.nordstromrack.com/search?query=sneakers+sale&sortBy=PriceAscending' },
  // Bags
  { label: 'handbags-sale',         url: 'https://www.nordstromrack.com/sale/women/handbags-accessories?sortBy=PriceAscending' },
  { label: 'backpacks',             url: 'https://www.nordstromrack.com/search?query=backpack+sale&sortBy=PriceAscending' },
  // Apparel
  { label: 'jackets-women',         url: 'https://www.nordstromrack.com/sale/women/clothing/coats-jackets?sortBy=PriceAscending' },
  { label: 'jackets-men',           url: 'https://www.nordstromrack.com/sale/men/clothing/coats-jackets?sortBy=PriceAscending' },
  // Brands (designer resale potential)
  { label: 'nike-sale',             url: 'https://www.nordstromrack.com/brands/nike?sortBy=PriceAscending' },
  { label: 'adidas-sale',           url: 'https://www.nordstromrack.com/brands/adidas?sortBy=PriceAscending' },
  { label: 'under-armour',          url: 'https://www.nordstromrack.com/brands/under-armour?sortBy=PriceAscending' },
  // Jewelry (high margin)
  { label: 'jewelry-sale',          url: 'https://www.nordstromrack.com/sale/women/accessories/jewelry?sortBy=PriceAscending' },
];

function linkFilter(href) {
  return !!(href && (
    href.includes('/s/') ||
    href.match(/nordstromrack\.com\/(brands|sale|categories)\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+/) ||
    href.match(/\/\d{7,}$/)
  ));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.nordstromrack.com${href}`;
  return base.split('?')[0].split('#')[0];
}

async function runNordstromRackDiscovery(options = {}) {
  const getContext = () => {
    if (process.env.PROXY_ENABLED === 'true') return newContext();
    return newBestBuyContext();
  };

  return runStoreDiscovery({
    storeSlug:  STORE_SLUG,
    storeLabel: STORE_LABEL,
    pages:      options.pages || DISCOVERY_PAGES,
    getContext,
    linkFilter,
    cleanUrl,
    maxPerPage: options.maxPerPage || 30,
    maxTotal:   options.maxTotal   || 120,
    delayMs:    options.delayMs    || 2500,
    maxConsecutiveEmpty: 2,
  });
}

module.exports = { runNordstromRackDiscovery, runDiscovery: runNordstromRackDiscovery };

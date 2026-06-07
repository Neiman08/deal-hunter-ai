/**
 * Burlington Discovery Engine — Akamai protected
 *
 * Burlington (Burlington Coat Factory) uses residential proxy.
 * If blocked → log, stop, never crash.
 * Good for: coats, shoes, handbags, home goods, toys at deep discount.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'burlington';
const STORE_LABEL = 'Burlington';

const DISCOVERY_PAGES = [
  // Sale hubs
  { label: 'sale-all',              url: 'https://www.burlington.com/category/sale?sortby=price_low_to_high' },
  { label: 'clearance-all',         url: 'https://www.burlington.com/category/clearance?sortby=price_low_to_high' },
  // Coats (flagship category)
  { label: 'coats-women',           url: 'https://www.burlington.com/category/womens-coats?sortby=price_low_to_high' },
  { label: 'coats-men',             url: 'https://www.burlington.com/category/mens-coats?sortby=price_low_to_high' },
  { label: 'coats-kids',            url: 'https://www.burlington.com/category/kids-coats?sortby=price_low_to_high' },
  // Shoes
  { label: 'shoes-women',           url: 'https://www.burlington.com/category/womens-shoes?sortby=price_low_to_high' },
  { label: 'shoes-men',             url: 'https://www.burlington.com/category/mens-shoes?sortby=price_low_to_high' },
  // Handbags
  { label: 'handbags-sale',         url: 'https://www.burlington.com/category/handbags?sortby=price_low_to_high' },
  // Home & decor
  { label: 'home-sale',             url: 'https://www.burlington.com/category/home?sortby=price_low_to_high' },
  { label: 'bedding-sale',          url: 'https://www.burlington.com/category/bedding?sortby=price_low_to_high' },
  // Baby & kids
  { label: 'baby-clearance',        url: 'https://www.burlington.com/category/baby?sortby=price_low_to_high' },
  { label: 'toys-sale',             url: 'https://www.burlington.com/category/toys?sortby=price_low_to_high' },
  // Search deals
  { label: 'search-nike',           url: 'https://www.burlington.com/search?q=nike&sortby=price_low_to_high' },
  { label: 'search-ugg',            url: 'https://www.burlington.com/search?q=ugg&sortby=price_low_to_high' },
  { label: 'search-north-face',     url: 'https://www.burlington.com/search?q=north+face&sortby=price_low_to_high' },
];

function linkFilter(href) {
  return !!(href && (
    href.includes('/product/') ||
    href.match(/burlington\.com\/product\/[a-zA-Z0-9-]+\/\d+/) ||
    href.match(/\/\d{7,}$/)
  ));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.burlington.com${href}`;
  return base.split('?')[0].split('#')[0];
}

async function runBurlingtonDiscovery(options = {}) {
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
    maxPerPage: options.maxPerPage || 25,
    maxTotal:   options.maxTotal   || 100,
    delayMs:    options.delayMs    || 3000,
    maxConsecutiveEmpty: 2,
  });
}

module.exports = { runBurlingtonDiscovery, runDiscovery: runBurlingtonDiscovery };

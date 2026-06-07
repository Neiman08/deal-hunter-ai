/**
 * Marshalls Discovery Engine — Akamai protected
 *
 * TJX platform (same infra as TJ Maxx). Uses residential proxy.
 * If Akamai blocks → log, stop, never crash.
 * Good for: designer bags, cookware, shoes, home goods, clothing.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'marshalls';
const STORE_LABEL = 'Marshalls';

const DISCOVERY_PAGES = [
  // Clearance hubs
  { label: 'clearance-home',        url: 'https://www.marshalls.com/us/store/jump/topic/clearance-home/cat3340002' },
  { label: 'clearance-women',       url: 'https://www.marshalls.com/us/store/jump/topic/clearance-clothing/cat4560005' },
  { label: 'clearance-shoes',       url: 'https://www.marshalls.com/us/store/jump/topic/clearance-shoes/cat4370005' },
  { label: 'clearance-accessories', url: 'https://www.marshalls.com/us/store/jump/topic/clearance-accessories/cat4330005' },
  // Search (high resale value items)
  { label: 'search-handbag',        url: 'https://www.marshalls.com/us/store/search?searchTerm=handbag' },
  { label: 'search-coach',          url: 'https://www.marshalls.com/us/store/search?searchTerm=coach' },
  { label: 'search-michael-kors',   url: 'https://www.marshalls.com/us/store/search?searchTerm=michael+kors' },
  { label: 'search-kate-spade',     url: 'https://www.marshalls.com/us/store/search?searchTerm=kate+spade' },
  { label: 'search-le-creuset',     url: 'https://www.marshalls.com/us/store/search?searchTerm=le+creuset' },
  { label: 'search-cookware',       url: 'https://www.marshalls.com/us/store/search?searchTerm=cookware' },
  { label: 'search-shoes',          url: 'https://www.marshalls.com/us/store/search?searchTerm=shoes' },
  { label: 'search-luggage',        url: 'https://www.marshalls.com/us/store/search?searchTerm=luggage' },
  { label: 'search-bedding',        url: 'https://www.marshalls.com/us/store/search?searchTerm=bedding' },
  { label: 'search-jewelry',        url: 'https://www.marshalls.com/us/store/search?searchTerm=jewelry' },
  { label: 'search-perfume',        url: 'https://www.marshalls.com/us/store/search?searchTerm=perfume' },
];

function linkFilter(href) {
  return !!(href && href.includes('/product/') && /\/\d{5,}$/.test(href.split('?')[0]));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.marshalls.com${href}`;
  return base.split('#')[0].split('?')[0];
}

async function runMarshallsDiscovery(options = {}) {
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

module.exports = { runMarshallsDiscovery, runDiscovery: runMarshallsDiscovery, DISCOVERY_PAGES };

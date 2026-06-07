/**
 * TJ Maxx Discovery Engine — Akamai protected
 *
 * TJX platform. Uses residential proxy. If Akamai blocks → log, stop, never crash.
 * Max 2 consecutive failures before skipping for the cycle.
 * Good for: designer bags, cookware, luggage, home goods, clothing.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'tj-maxx';
const STORE_LABEL = 'TJ Maxx';

const DISCOVERY_PAGES = [
  // Clearance hubs
  { label: 'clearance-home',        url: 'https://www.tjmaxx.tjx.com/store/jump/topic/clearance-home/cat3340002' },
  { label: 'clearance-women',       url: 'https://www.tjmaxx.tjx.com/store/jump/topic/clearance-clothing/cat4560005' },
  { label: 'clearance-accessories', url: 'https://www.tjmaxx.tjx.com/store/jump/topic/clearance-accessories/cat4330005' },
  { label: 'clearance-shoes',       url: 'https://www.tjmaxx.tjx.com/store/jump/topic/clearance-shoes/cat4370005' },
  { label: 'sale-home',             url: 'https://www.tjmaxx.tjx.com/store/browse/sale/home/home-store-brand/_/N-t7yZ1z13ya5' },
  { label: 'sale-handbags',         url: 'https://www.tjmaxx.tjx.com/store/browse/sale/handbags/_/N-rrqZ1z13ya5' },
  // Search terms (high resale value)
  { label: 'search-designer',       url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=designer+handbag' },
  { label: 'search-kate-spade',     url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=kate+spade' },
  { label: 'search-coach',          url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=coach' },
  { label: 'search-michael-kors',   url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=michael+kors' },
  { label: 'search-le-creuset',     url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=le+creuset' },
  { label: 'search-all-clad',       url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=all+clad' },
  { label: 'search-vitamix',        url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=vitamix' },
  { label: 'search-kitchenaid',     url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=kitchenaid' },
  { label: 'search-dyson',          url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=dyson' },
  { label: 'search-luggage',        url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=luggage' },
  { label: 'search-bedding',        url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=bedding' },
  { label: 'search-cookware',       url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=cookware' },
  { label: 'search-jewelry',        url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=gold+jewelry' },
  { label: 'search-perfume',        url: 'https://www.tjmaxx.tjx.com/store/search?searchTerm=perfume' },
];

function linkFilter(href) {
  return !!(href && href.includes('/product/') && /\/\d{5,}$/.test(href.split('?')[0]));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.tjmaxx.tjx.com${href}`;
  return base.split('#')[0].split('?')[0];
}

async function runTjMaxxDiscovery(options = {}) {
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

module.exports = { runTjMaxxDiscovery, runDiscovery: runTjMaxxDiscovery, DISCOVERY_PAGES };

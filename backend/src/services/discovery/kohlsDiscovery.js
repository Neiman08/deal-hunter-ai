/**
 * Kohl's Discovery Engine — Akamai protected
 *
 * Uses residential proxy. If Akamai blocks → log, stop, never crash.
 * Max 2 failures before skipping (proxyManager handles threshold).
 * Good for: clothing, shoes, home goods, small appliances, Kohl's Cash opportunities.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'kohls';
const STORE_LABEL = "Kohl's";

const DISCOVERY_PAGES = [
  // Clearance hubs (best deal density)
  { label: 'clearance-all',         url: 'https://www.kohls.com/catalog/sale-clearance.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-women',       url: 'https://www.kohls.com/catalog/womens-clearance-clothing.jsp?CN=Gender:Womens+Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-men',         url: 'https://www.kohls.com/catalog/mens-clearance-clothing.jsp?CN=Gender:Mens+Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-kids',        url: 'https://www.kohls.com/catalog/girls-boys-clearance-clothing.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-home',        url: 'https://www.kohls.com/catalog/clearance-home.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-shoes',       url: 'https://www.kohls.com/catalog/clearance-shoes.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-appliances',  url: 'https://www.kohls.com/catalog/kitchen-dining-clearance.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'clearance-electronics', url: 'https://www.kohls.com/catalog/electronics-clearance.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  // Brand clearance (resale value)
  { label: 'nike-clearance',        url: 'https://www.kohls.com/catalog/nike-clearance.jsp?CN=Brand:Nike+Promotions:Clearance&PPP=60&S=LHPRC' },
  { label: 'adidas-clearance',      url: 'https://www.kohls.com/catalog/adidas-clearance.jsp?CN=Brand:Adidas+Promotions:Clearance&PPP=60&S=LHPRC' },
  // Sale pages
  { label: 'sale-all',              url: 'https://www.kohls.com/catalog/sale-clothing-shoes.jsp?CN=Promotions:Sale&PPP=60&S=LHPRC' },
  { label: 'sale-jewelry',          url: 'https://www.kohls.com/catalog/sale-jewelry-watches.jsp?CN=Promotions:Sale&PPP=60&S=LHPRC' },
  { label: 'toys-clearance',        url: 'https://www.kohls.com/catalog/toys-clearance.jsp?CN=Promotions:Clearance&PPP=60&S=LHPRC' },
  // Search deals
  { label: 'search-kitchenaid',     url: 'https://www.kohls.com/search/kls-search-results.jsp?search=kitchenaid' },
  { label: 'search-dyson',          url: 'https://www.kohls.com/search/kls-search-results.jsp?search=dyson' },
  { label: 'search-ninja',          url: 'https://www.kohls.com/search/kls-search-results.jsp?search=ninja+blender' },
  { label: 'search-keurig',         url: 'https://www.kohls.com/search/kls-search-results.jsp?search=keurig' },
  { label: 'search-instant-pot',    url: 'https://www.kohls.com/search/kls-search-results.jsp?search=instant+pot' },
  { label: 'deals-50-off',          url: 'https://www.kohls.com/catalog/sale-50-percent-off-or-more.jsp?N=4294967040' },
  { label: 'deals-70-off',          url: 'https://www.kohls.com/catalog/sale-70-percent-off-or-more.jsp?N=4294967040' },
];

function linkFilter(href) {
  return !!(href && (
    href.includes('/p/') ||
    href.includes('/product/') ||
    href.includes('/prd~') ||
    /\/prd~\w+/.test(href)
  ));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.kohls.com${href}`;
  return base.split('#')[0].split('?')[0];
}

async function runKohlsDiscovery(options = {}) {
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

module.exports = { runKohlsDiscovery, runDiscovery: runKohlsDiscovery, DISCOVERY_PAGES };

/**
 * GameStop Discovery Engine
 *
 * GameStop does not use Akamai aggressively — direct connection works.
 * Great for resale: pre-owned consoles, games, Pokemon cards, accessories.
 */

const { newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'gamestop';
const STORE_LABEL = 'GameStop';

const DISCOVERY_PAGES = [
  // Primary deal pages
  { label: 'deals',                  url: 'https://www.gamestop.com/deals' },
  { label: 'pre-owned',              url: 'https://www.gamestop.com/browse/pre-owned' },
  // Clearance & sale collections
  { label: 'clearance',              url: 'https://www.gamestop.com/collection/clearance' },
  { label: 'sale',                   url: 'https://www.gamestop.com/collection/sale' },
  { label: 'best-deals',             url: 'https://www.gamestop.com/collection/best-deals' },
  // Pre-owned by platform
  { label: 'pre-owned-consoles',     url: 'https://www.gamestop.com/collection/pre-owned-consoles' },
  { label: 'pre-owned-games',        url: 'https://www.gamestop.com/collection/pre-owned-games' },
  { label: 'pre-owned-accessories',  url: 'https://www.gamestop.com/collection/pre-owned-accessories' },
  // Nintendo Switch 2 + Switch
  { label: 'nintendo-switch',        url: 'https://www.gamestop.com/collection/nintendo-switch-consoles' },
  { label: 'nintendo-games',         url: 'https://www.gamestop.com/collection/nintendo-switch-games' },
  { label: 'nintendo-accessories',   url: 'https://www.gamestop.com/collection/nintendo-switch-accessories' },
  // PlayStation
  { label: 'ps5-consoles',           url: 'https://www.gamestop.com/collection/playstation-5-consoles' },
  { label: 'ps5-accessories',        url: 'https://www.gamestop.com/collection/playstation-5-accessories' },
  { label: 'ps5-games',              url: 'https://www.gamestop.com/collection/playstation-5-games' },
  { label: 'ps4-pre-owned',          url: 'https://www.gamestop.com/collection/pre-owned-playstation-4-games' },
  // Xbox
  { label: 'xbox-consoles',          url: 'https://www.gamestop.com/collection/xbox-series-x-s-consoles' },
  { label: 'xbox-accessories',       url: 'https://www.gamestop.com/collection/xbox-series-x-s-accessories' },
  { label: 'xbox-games',             url: 'https://www.gamestop.com/collection/xbox-series-x-s-games' },
  // Trading cards & collectibles (high resale)
  { label: 'trading-cards',          url: 'https://www.gamestop.com/collection/trading-card-games' },
  { label: 'pokemon-cards',          url: 'https://www.gamestop.com/collection/pokemon' },
  { label: 'funko-pop',              url: 'https://www.gamestop.com/collection/funko' },
  { label: 'collectibles',           url: 'https://www.gamestop.com/collection/collectibles' },
  // Controllers & headsets (high turnover)
  { label: 'controllers',            url: 'https://www.gamestop.com/collection/controllers' },
  { label: 'headsets',               url: 'https://www.gamestop.com/collection/headsets' },
  { label: 'gaming-chairs',          url: 'https://www.gamestop.com/collection/gaming-chairs' },
];

function linkFilter(href) {
  // GameStop product URLs: /{category}/products/{name}/{id}.html
  return !!(href && href.includes('/products/') && /\/\d{5,}\.html/.test(href));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.gamestop.com${href}`;
  return base.split('?')[0].split('#')[0];
}

async function runGameStopDiscovery(options = {}) {
  // Rotate starting page each 30-min cycle
  const cycleNum  = Math.floor(Date.now() / (30 * 60 * 1000));
  const basePages = options.pages || DISCOVERY_PAGES;
  const startIdx  = (cycleNum * 5) % basePages.length;
  const pages     = [...basePages.slice(startIdx), ...basePages.slice(0, startIdx)];

  return runStoreDiscovery({
    storeSlug:  STORE_SLUG,
    storeLabel: STORE_LABEL,
    pages,
    getContext: () => newBestBuyContext(),
    linkFilter,
    cleanUrl,
    maxPerPage: options.maxPerPage || 30,
    maxTotal:   options.maxTotal   || 200,
    delayMs:    options.delayMs    || 2000,
    maxConsecutiveEmpty: 4,
  });
}

module.exports = { runGameStopDiscovery, runDiscovery: runGameStopDiscovery };

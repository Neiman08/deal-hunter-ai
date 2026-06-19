/**
 * GameStop Discovery Engine
 *
 * GameStop does not use Akamai aggressively — direct connection works.
 * Great for resale: pre-owned consoles, games, Pokemon cards, accessories.
 */

const { newContext, newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'gamestop';
const STORE_LABEL = 'GameStop';

const DISCOVERY_PAGES = [
  // Primary deal pages
  { label: 'deals',                    url: 'https://www.gamestop.com/deals' },
  { label: 'pre-owned',                url: 'https://www.gamestop.com/browse/pre-owned' },
  // Clearance & sale collections
  { label: 'clearance',                url: 'https://www.gamestop.com/collection/clearance' },
  { label: 'sale',                     url: 'https://www.gamestop.com/collection/sale' },
  { label: 'best-deals',               url: 'https://www.gamestop.com/collection/best-deals' },
  { label: 'new-arrivals',             url: 'https://www.gamestop.com/collection/new-arrivals' },
  // Pre-owned by platform
  { label: 'pre-owned-consoles',       url: 'https://www.gamestop.com/collection/pre-owned-consoles' },
  { label: 'pre-owned-games',          url: 'https://www.gamestop.com/collection/pre-owned-games' },
  { label: 'pre-owned-accessories',    url: 'https://www.gamestop.com/collection/pre-owned-accessories' },
  { label: 'pre-owned-controllers',    url: 'https://www.gamestop.com/collection/pre-owned-controllers' },
  // Nintendo Switch 2 + Switch
  { label: 'nintendo-switch',          url: 'https://www.gamestop.com/collection/nintendo-switch-consoles' },
  { label: 'nintendo-games',           url: 'https://www.gamestop.com/collection/nintendo-switch-games' },
  { label: 'nintendo-accessories',     url: 'https://www.gamestop.com/collection/nintendo-switch-accessories' },
  { label: 'switch2-consoles',         url: 'https://www.gamestop.com/collection/nintendo-switch-2-consoles' },
  { label: 'switch2-games',            url: 'https://www.gamestop.com/collection/nintendo-switch-2-games' },
  // PlayStation
  { label: 'ps5-consoles',             url: 'https://www.gamestop.com/collection/playstation-5-consoles' },
  { label: 'ps5-accessories',          url: 'https://www.gamestop.com/collection/playstation-5-accessories' },
  { label: 'ps5-games',                url: 'https://www.gamestop.com/collection/playstation-5-games' },
  { label: 'ps4-pre-owned',            url: 'https://www.gamestop.com/collection/pre-owned-playstation-4-games' },
  { label: 'ps5-controllers',          url: 'https://www.gamestop.com/collection/playstation-5-controllers' },
  { label: 'psvr2',                    url: 'https://www.gamestop.com/collection/playstation-vr2' },
  // Xbox
  { label: 'xbox-consoles',            url: 'https://www.gamestop.com/collection/xbox-series-x-s-consoles' },
  { label: 'xbox-accessories',         url: 'https://www.gamestop.com/collection/xbox-series-x-s-accessories' },
  { label: 'xbox-games',               url: 'https://www.gamestop.com/collection/xbox-series-x-s-games' },
  { label: 'xbox-controllers',         url: 'https://www.gamestop.com/collection/xbox-series-x-s-controllers' },
  { label: 'xbox-one-pre-owned',       url: 'https://www.gamestop.com/collection/pre-owned-xbox-one-games' },
  // PC Gaming
  { label: 'pc-gaming',                url: 'https://www.gamestop.com/collection/pc-gaming' },
  { label: 'gaming-laptops',           url: 'https://www.gamestop.com/collection/gaming-laptops' },
  { label: 'gaming-keyboards',         url: 'https://www.gamestop.com/collection/gaming-keyboards' },
  { label: 'gaming-mice',              url: 'https://www.gamestop.com/collection/gaming-mice' },
  { label: 'gaming-monitors',          url: 'https://www.gamestop.com/collection/gaming-monitors' },
  // Trading cards & collectibles (high resale)
  { label: 'trading-cards',            url: 'https://www.gamestop.com/collection/trading-card-games' },
  { label: 'pokemon-cards',            url: 'https://www.gamestop.com/collection/pokemon' },
  { label: 'yugioh-cards',             url: 'https://www.gamestop.com/collection/yu-gi-oh' },
  { label: 'funko-pop',                url: 'https://www.gamestop.com/collection/funko' },
  { label: 'collectibles',             url: 'https://www.gamestop.com/collection/collectibles' },
  { label: 'disney-lorcana',           url: 'https://www.gamestop.com/collection/disney-lorcana' },
  { label: 'magic-gathering',          url: 'https://www.gamestop.com/collection/magic-the-gathering' },
  // Controllers & peripherals (high turnover)
  { label: 'controllers',              url: 'https://www.gamestop.com/collection/controllers' },
  { label: 'headsets',                 url: 'https://www.gamestop.com/collection/headsets' },
  { label: 'gaming-chairs',            url: 'https://www.gamestop.com/collection/gaming-chairs' },
  { label: 'steering-wheels',          url: 'https://www.gamestop.com/collection/steering-wheels' },
  { label: 'vr-accessories',           url: 'https://www.gamestop.com/collection/vr-accessories' },
  // Toys & licensed products (high margin)
  { label: 'toys',                     url: 'https://www.gamestop.com/collection/toys' },
  { label: 'lego',                     url: 'https://www.gamestop.com/collection/lego' },
  { label: 'action-figures',           url: 'https://www.gamestop.com/collection/action-figures' },
  { label: 'plush-figures',            url: 'https://www.gamestop.com/collection/plush' },
  // Apparel & lifestyle
  { label: 'apparel',                  url: 'https://www.gamestop.com/collection/apparel' },
  { label: 'accessories-lifestyle',    url: 'https://www.gamestop.com/collection/lifestyle-accessories' },
];

function linkFilter(href) {
  if (!href || !href.includes('/products/')) return false;
  const clean = href.split('?')[0].split('#')[0];
  // Shopify format: /products/product-slug (current GameStop)
  // Old format: /category/products/name/12345.html
  return /\/products\/[a-z0-9][a-z0-9-]{2,}/i.test(clean);
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
    getContext: () => process.env.PROXY_ENABLED === 'true' ? newContext() : newBestBuyContext(),
    linkFilter,
    cleanUrl,
    maxPerPage: options.maxPerPage || 30,
    maxTotal:   options.maxTotal   || 200,
    delayMs:    options.delayMs    || 2000,
    maxConsecutiveEmpty: 4,
  });
}

module.exports = { runGameStopDiscovery, runDiscovery: runGameStopDiscovery };

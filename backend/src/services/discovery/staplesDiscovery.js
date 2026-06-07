/**
 * Staples Discovery Engine
 * Direct connection — Staples does not use aggressive bot protection.
 * Good for: laptops, printers, chairs, monitors, office supplies.
 */

const { newBestBuyContext } = require('../browserEngine');
const { runStoreDiscovery } = require('./baseRetailerDiscovery');

const STORE_SLUG  = 'staples';
const STORE_LABEL = 'Staples';

const DISCOVERY_PAGES = [
  // Primary deal/sale pages
  { label: 'deals',                url: 'https://www.staples.com/deals' },
  { label: 'tech-deals',           url: 'https://www.staples.com/sbd/content/technology/deals' },
  { label: 'clearance',            url: 'https://www.staples.com/deals/Clearance-Deals/BI1278394' },
  { label: 'weekly-sale',          url: 'https://www.staples.com/deals/Weekly-Ad-Sale-Items/BI1226530' },
  // Laptops & computers — multiple sorts
  { label: 'laptops-lowprice',     url: 'https://www.staples.com/Laptops/cat_CL139766?sortby=lowprice' },
  { label: 'laptops-sale',         url: 'https://www.staples.com/Laptops/cat_CL139766?sortby=customerRatings&priceTo=600' },
  { label: 'chromebooks',          url: 'https://www.staples.com/chromebooks/cat_CL139771?sortby=lowprice' },
  { label: 'desktops',             url: 'https://www.staples.com/Desktops/cat_CL139773?sortby=lowprice' },
  // Monitors
  { label: 'monitors',             url: 'https://www.staples.com/Monitors/cat_CL140086?sortby=lowprice' },
  { label: 'monitors-widescreen',  url: 'https://www.staples.com/Monitors/cat_CL140086?sortby=lowprice&priceFrom=0&priceTo=300' },
  // Printers & copiers
  { label: 'printers',             url: 'https://www.staples.com/Printers/cat_CL140081?sortby=lowprice' },
  { label: 'all-in-one-printers',  url: 'https://www.staples.com/All-in-One-Printers/cat_CL140083?sortby=lowprice' },
  // Chairs & furniture
  { label: 'chairs-cheap',         url: 'https://www.staples.com/Office-Chairs/cat_CL162034?sortby=lowprice&priceTo=200' },
  { label: 'chairs-mid',           url: 'https://www.staples.com/Office-Chairs/cat_CL162034?sortby=lowprice&priceFrom=200&priceTo=500' },
  { label: 'standing-desks',       url: 'https://www.staples.com/Standing-Desks/cat_CL162001?sortby=lowprice' },
  { label: 'desks-furniture',      url: 'https://www.staples.com/Desks/cat_CL161992?sortby=lowprice' },
  // Tablets & mobile
  { label: 'tablets',              url: 'https://www.staples.com/Tablets/cat_CL140090?sortby=lowprice' },
  { label: 'headphones',           url: 'https://www.staples.com/Headphones/cat_CL140094?sortby=lowprice' },
  { label: 'external-drives',      url: 'https://www.staples.com/External-Hard-Drives/cat_SS3226?sortby=lowprice' },
  { label: 'webcams',              url: 'https://www.staples.com/Webcams/cat_CL140097?sortby=lowprice' },
  { label: 'shredders',            url: 'https://www.staples.com/Paper-Shredders/cat_CL140078?sortby=lowprice' },
];

function linkFilter(href) {
  // Staples product URLs: /{name}/product_{ID} or /{name}/cat_{CODE}/{ID}
  return !!(href && (href.includes('/product_') || href.match(/\/cat_[A-Za-z]+\d+\/[a-zA-Z0-9-]{5,}/)));
}

function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.staples.com${href}`;
  return base.split('?')[0].split('#')[0];
}

async function runStaplesDiscovery(options = {}) {
  // Rotate starting page each 30-min cycle
  const cycleNum  = Math.floor(Date.now() / (30 * 60 * 1000));
  const basePages = options.pages || DISCOVERY_PAGES;
  const startIdx  = (cycleNum * 4) % basePages.length;
  const pages     = [...basePages.slice(startIdx), ...basePages.slice(0, startIdx)];

  return runStoreDiscovery({
    storeSlug:  STORE_SLUG,
    storeLabel: STORE_LABEL,
    pages,
    getContext: () => newBestBuyContext(),
    linkFilter,
    cleanUrl,
    waitSelector: 'a[href*="/product_"]',
    maxPerPage: options.maxPerPage || 30,
    maxTotal:   options.maxTotal   || 150,
    delayMs:    options.delayMs    || 2500,
    maxConsecutiveEmpty: 3,
  });
}

module.exports = { runStaplesDiscovery, runDiscovery: runStaplesDiscovery };

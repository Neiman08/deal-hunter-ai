/**
 * Office Depot product scraper — HTTP-only (no Playwright)
 *
 * OD product pages serve full SSR HTML with LD+JSON containing all price/stock data.
 * No JS execution needed. Using proxy agent because Render datacenter IPs are blocked.
 */

const https = require('https');
const http  = require('http');
const { buildHttpProxyAgent } = require('../../utils/proxyUtils');

const STORE_SLUG = 'office-depot';

function fetchHtml(url, hops = 0) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  const agent = buildHttpProxyAgent('OfficeDept');
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https:') ? https : http;
    const req  = lib.get(url, {
      timeout: 30000,
      rejectUnauthorized: false,
      agent,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        // Resolve relative redirects against the base URL
        const base = new URL(url);
        const next = new URL(res.headers.location, base.origin).href;
        return fetchHtml(next, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        // Decompress gzip/deflate if needed
        const enc = res.headers['content-encoding'] || '';
        if (enc.includes('gzip') || enc.includes('deflate')) {
          const zlib = require('zlib');
          zlib.unzip(raw, (err, buf) => {
            if (err) return reject(err);
            resolve(buf.toString('utf8'));
          });
        } else {
          resolve(raw.toString('utf8'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

async function scrapeOfficeDepotProduct(url) {
  const html = await fetchHtml(url);

  // Detect homepage redirect (dead product — OD sends back the store homepage)
  if (html.includes('<title>Office Supplies, Furniture, Technology at Office Depot</title>')) {
    throw new Error('product_not_found');
  }

  // Extract LD+JSON block
  const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!ldMatch) throw new Error('No LD+JSON found on page');

  let item;
  try {
    const parsed = JSON.parse(ldMatch[1]);
    item = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    throw new Error(`LD+JSON parse error: ${e.message}`);
  }

  if (!item?.offers) throw new Error('No offers in LD+JSON');

  const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
  const currentPrice  = parseFloat(offer?.price) || null;
  // highPrice="None" is a literal string OD uses when not on sale — treat as null
  const highPriceRaw  = offer?.highPrice;
  const regularPrice  = (highPriceRaw && highPriceRaw !== 'None')
    ? parseFloat(highPriceRaw) || null
    : null;

  return {
    name:         item.name || '',
    brand:        item.brand?.name || '',
    sku:          item.sku || item.mpn || '',
    currentPrice,
    regularPrice,
    inStock:      offer?.availability?.includes('InStock') ?? false,
    imageUrl:     Array.isArray(item.image) ? item.image[0] : item.image,
    productUrl:   url,
    storeSlug:    STORE_SLUG,
    source:       'ld+json-http',
  };
}

async function scanOfficeDepotDeals() {
  const { runOfficeDepotDiscovery } = require('../discovery/officeDepotDiscovery');
  return runOfficeDepotDiscovery();
}

module.exports = { scrapeOfficeDepotProduct, scanOfficeDepotDeals };

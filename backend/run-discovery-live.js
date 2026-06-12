require('dotenv').config();

// Mark this process as the worker so workerOnly guards allow heavy endpoints
process.env.IS_WORKER = 'true';

const { runAlertEngine }      = require('./src/services/alertEngine');
const { detectRecentChanges } = require('./src/services/priceChangeDetector');
const { restartBrowserPool }  = require('./src/services/browserEngine');
const { query }               = require('./src/config/database');
const { claimNextPendingJob, markCompleted, markFailed } = require('./src/services/discoveryQueue');

const POOL_RESTART_EVERY = parseInt(process.env.POOL_RESTART_CYCLES) || 5;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let cycleCount = 0;

function banner(msg, char = '═') {
  const line = char.repeat(60);
  console.log(`\n${line}\n  ${msg}\n${line}`);
}

// ─── Stats query (all stores) ─────────────────────────────────────────────────
async function getStats() {
  const r = await query(`
    SELECT
      s.slug,
      COUNT(DISTINCT p.id)                                          AS total_products,
      COUNT(d.id) FILTER (WHERE d.is_active = true)                AS active_deals,
      COUNT(d.id) FILTER (WHERE d.is_active = false)               AS inactive_deals,
      ROUND(AVG(d.discount_percent) FILTER (WHERE d.is_active=true)) AS avg_discount,
      ROUND(AVG(d.roi_percent)      FILTER (WHERE d.is_active=true)) AS avg_roi,
      MAX(p.created_at) AS last_discovery
    FROM stores s
    LEFT JOIN products p ON p.store_id = s.id
    LEFT JOIN deals d    ON d.store_id = s.id
    WHERE s.slug IN (
      'target','best-buy','lowes','home-depot','gamestop',
      'office-depot','staples','nordstrom-rack','macys',
      'kohls','tj-maxx','marshalls','burlington',
      'costco','walmart'
    )
    GROUP BY s.slug
    ORDER BY active_deals DESC
  `);
  return r.rows;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanupDeals() {
  banner('🧹 CLEANUP', '─');

  // 1) Strip URL fragments / query params for canonical dedup
  const c1 = await query(`
    UPDATE products
    SET product_url = split_part(split_part(product_url, '#', 1), '?', 1)
    WHERE product_url LIKE '%#%' OR product_url LIKE '%?%'
    RETURNING id
  `);
  if (c1.rowCount > 0) console.log(`  ✂️  Stripped query params from ${c1.rowCount} URLs`);

  // 2) Deactivate stale / fake deals
  // Rules (must stay in sync with scraperBase.js saveProductData):
  //   - discount >= 30% → active regardless of profit (high_discount_override)
  //   - discount 20-29.99% → needs estimated_profit > 0 AND roi_percent > 0
  //   - discount < 20% → inactive
  const c2 = await query(`
    UPDATE deals SET is_active=false
    WHERE last_seen_at < NOW() - INTERVAL '7 days'
       OR (
         is_error_price = false
         AND discount_percent < 30
         AND (
           regular_price IS NULL
           OR discount_percent < 20
           OR estimated_profit <= 0
           OR roi_percent <= 0
         )
       )
    RETURNING id
  `);
  console.log(`  🗑️  Deactivated ${c2.rowCount} stale/fake deals`);

  // 3) Deactivate Best Buy search-page and inflated refurbished entries
  const c3 = await query(`
    UPDATE deals d SET is_active=false
    FROM products p, stores s
    WHERE p.id=d.product_id AND s.id=d.store_id AND s.slug='best-buy'
    AND (
      p.product_url LIKE '%searchpage.jsp%'
      OR (
        (LOWER(p.name) LIKE '%refurbished%' OR LOWER(p.name) LIKE '%renewed%'
         OR LOWER(p.name) LIKE '%open box%' OR LOWER(p.name) LIKE '%geek squad certified%')
        AND d.regular_price > d.deal_price * 3
      )
    )
    RETURNING d.id
  `);
  if (c3.rowCount > 0) console.log(`  🗑️  Deactivated ${c3.rowCount} Best Buy false deals`);

  // 4) Reactivate qualifying deals for all active stores
  // Must stay in sync with scraperBase.js and recalculate-deals endpoint:
  //   - discount >= 30% → active (high_discount_override, no profit requirement)
  //   - discount 20-29.99% → active only with estimated_profit > 0 AND roi_percent > 0
  const c4 = await query(`
    UPDATE deals d SET is_active=true
    FROM products p, stores s
    WHERE p.id=d.product_id AND s.id=d.store_id
    AND s.slug IN (
      'target','best-buy','lowes','home-depot','gamestop',
      'office-depot','staples','nordstrom-rack','macys',
      'kohls','tj-maxx','marshalls','burlington',
      'costco','walmart'
    )
    AND p.product_url NOT LIKE '%searchpage.jsp%'
    AND d.deal_price < 10000
    AND d.last_seen_at >= NOW() - INTERVAL '7 days'
    AND NOT (
      s.slug='best-buy' AND d.regular_price > d.deal_price * 3
      AND (LOWER(p.name) LIKE '%refurbished%' OR LOWER(p.name) LIKE '%renewed%'
           OR LOWER(p.name) LIKE '%open box%' OR LOWER(p.name) LIKE '%geek squad certified%')
    )
    AND (
      d.is_error_price = true
      OR d.discount_percent >= 30
      OR (
        d.regular_price IS NOT NULL
        AND d.discount_percent >= 20
        AND d.estimated_profit > 0
        AND d.roi_percent > 0
      )
    )
    RETURNING d.id
  `);
  console.log(`  ✅ Reactivated ${c4.rowCount} qualifying deals`);

  // 5) Dedup active deals by canonical URL (keep highest-score one)
  const c5 = await query(`
    WITH ranked AS (
      SELECT d.id,
        ROW_NUMBER() OVER (
          PARTITION BY split_part(split_part(p.product_url,'#',1),'?',1)
          ORDER BY d.opportunity_score DESC, d.estimated_profit DESC,
                   d.roi_percent DESC, d.last_seen_at DESC, d.id DESC
        ) rn
      FROM deals d JOIN products p ON p.id=d.product_id
      WHERE d.is_active=true
    )
    UPDATE deals d SET is_active=false
    FROM ranked r WHERE d.id=r.id AND r.rn > 1
    RETURNING d.id
  `);
  if (c5.rowCount > 0) console.log(`  🔁 Deduped ${c5.rowCount} duplicate active deals`);

  console.log('  ✅ Cleanup complete');
}

// ─── Worker proxy diagnostic ──────────────────────────────────────────────────
// Triggered via discovery_jobs queue (store_slug = 'worker-proxy-test').
// Uses the same buildHttpProxyAgent('OfficeDept') call as officeDepotDiscovery.js
// so the result is directly comparable to a real OD discovery run from this worker.
async function runWorkerProxyTest() {
  const https = require('https');
  const http  = require('http');
  const { buildHttpProxyAgent } = require('./src/utils/proxyUtils');

  const TEST_URLS = [
    'https://geo.brdtest.com/welcome.txt',
    'https://lumtest.com/myip.json',
    'https://www.officedepot.com/product_sitemap_0.xml',
  ];

  const host  = process.env.PROXY_HOST  || null;
  const port  = parseInt(process.env.PROXY_PORT) || 22225;
  const user  = process.env.PROXY_USER  || '';
  const pass  = process.env.PROXY_PASS  || '';
  const agent = buildHttpProxyAgent('OfficeDept');

  function classifyError(msg, statusCode) {
    if (statusCode === 407 || String(msg).includes('407')) return 'PROXY_AUTH_407';
    const m = String(msg).toLowerCase();
    if (m.includes('etimedout') || m.includes('timeout'))                     return 'TIMEOUT';
    if (m.includes('cert') || m.includes('tls') || m.includes('ssl'))         return 'TLS';
    if (m.includes('enotfound') || m.includes('dns'))                         return 'DNS';
    if (m.includes('econnrefused') || m.includes('econnreset') || m.includes('socket hang up')) return 'CONNECTION';
    return 'UNKNOWN';
  }

  function fetchUrl(targetUrl) {
    const t0 = Date.now();
    return new Promise(resolve => {
      const lib  = targetUrl.startsWith('https:') ? https : http;
      const opts = {
        timeout: 25000,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      };
      if (agent) opts.agent = agent;

      const fail = (msg, statusCode = null) => resolve({
        url: targetUrl, ok: false, http_status: statusCode,
        ip: null, country: null, elapsed_ms: Date.now() - t0,
        body_snippet: null,
        error: { message: msg, type: classifyError(msg, statusCode) },
      });

      const req = lib.get(targetUrl, opts, res2 => {
        const chunks = [];
        res2.on('data', c => chunks.push(c));
        res2.on('end', () => {
          const elapsed = Date.now() - t0;
          const body    = Buffer.concat(chunks).toString('utf8');

          if (res2.statusCode !== 200) {
            return resolve({
              url: targetUrl, ok: false, http_status: res2.statusCode,
              ip: null, country: null, elapsed_ms: elapsed,
              body_snippet: body.slice(0, 500),
              error: { message: `HTTP ${res2.statusCode}`, type: classifyError(`HTTP ${res2.statusCode}`, res2.statusCode) },
            });
          }

          let ip = null, country = null;
          try {
            const parsed = JSON.parse(body);
            ip      = parsed.ip      || parsed.clientIp    || null;
            country = parsed.country || parsed.countryCode || null;
          } catch { /* not JSON */ }
          if (!ip) {
            const ipM  = body.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
            const cntM = body.match(/Country[:\s]+([A-Z]{2,})/i);
            ip      = ipM?.[1]  || null;
            country = cntM?.[1] || null;
          }

          resolve({
            url: targetUrl, ok: true, http_status: 200,
            ip, country, elapsed_ms: elapsed,
            body_snippet: body.slice(0, 500), error: null,
          });
        });
        res2.on('error', e => fail(e.message));
      });
      req.on('error',   e  => fail(e.message));
      req.on('timeout', () => { req.destroy(); fail('timeout'); });
    });
  }

  const tests = await Promise.all(TEST_URLS.map(fetchUrl));

  const result = {
    ok: tests.every(t => t.ok),
    proxy: {
      proxy_host:         host,
      proxy_port:         port,
      proxy_user_partial: user ? user.slice(0, 40) + '...' : '(not set)',
      proxy_pass_set:     !!pass,
      proxy_enabled:      process.env.PROXY_ENABLED,
      agent_created:      !!agent,
    },
    tests,
  };

  console.log(`[WorkerProxyTest] ok=${result.ok} proxy_host=${host} proxy_port=${port} agent=${!!agent}`);
  tests.forEach(t => {
    if (t.ok) console.log(`  ✅ ${t.url} → HTTP ${t.http_status} ip=${t.ip} country=${t.country} (${t.elapsed_ms}ms)`);
    else      console.log(`  ❌ ${t.url} → ${t.error.type}: ${t.error.message}`);
  });

  return result;
}

// ─── Office Depot single-product diagnostic ──────────────────────────────────
// Triggered via store_slug = 'od-product-diag'.
// 1. Fetches the sitemap to get the first real product URL.
// 2. Hits that URL with the EXACT same fetchHtml() + proxy as officedepot.js.
// 3. Logs HTTP status, headers, HTML size, patterns, LD+JSON parsing, save attempt.
// No side-effects (doesn't write products to DB).
async function runOdProductDiag() {
  const https  = require('https');
  const http   = require('http');
  const zlib   = require('zlib');
  const { buildHttpProxyAgent } = require('./src/utils/proxyUtils');

  // Rotate through all 4 sitemaps matching the discovery engine's cycle logic
  const SITEMAPS_DIAG = [
    'https://www.officedepot.com/product_sitemap_0.xml',
    'https://www.officedepot.com/product_sitemap_1.xml',
    'https://www.officedepot.com/product_sitemap_2.xml',
    'https://www.officedepot.com/product_sitemap_3.xml',
  ];
  const cycleSeedDiag = Math.floor(Date.now() / (30 * 60 * 1000));
  const sitemapDiagUrl = SITEMAPS_DIAG[cycleSeedDiag % SITEMAPS_DIAG.length];

  const diag = {
    step: null,
    sitemap_url: sitemapDiagUrl,
    product_url: null,
    proxy_port:  parseInt(process.env.PROXY_PORT) || null,
    proxy_user:  (process.env.PROXY_USER || '').slice(0, 40) + '...',
    agent_created: false,

    // HTTP response fields
    http_status:       null,
    content_encoding:  null,
    content_type:      null,
    html_length:       null,
    html_first_1000:   null,

    // Pattern checks
    has_ld_json:         false,
    has_next_data:       false,
    has_currentPrice:    false,
    has_salePrice:       false,
    has_offers:          false,
    has_price_literal:   false,
    homepage_redirect:   false,

    // Parse result
    parse_error:         null,
    parsed_name:         null,
    parsed_currentPrice: null,
    parsed_regularPrice: null,
    parsed_sku:          null,
    parsed_inStock:      null,

    // Save attempt
    save_attempted:  false,
    save_error:      null,
    save_error_sql:  null,
  };

  const agent = buildHttpProxyAgent('OfficeDept');
  diag.agent_created = !!agent;

  // Helper: raw HTTP fetch with full response metadata
  function rawFetch(url, hops = 0) {
    if (hops > 5) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
      const lib  = url.startsWith('https:') ? https : http;
      const opts = {
        timeout: 30000,
        rejectUnauthorized: false,
        agent,
        headers: {
          'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',  // no brotli — mirrors officedepot.js after fix
        },
      };
      const req = lib.get(url, opts, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const base = new URL(url);
          const next = new URL(res.headers.location, base.origin).href;
          return rawFetch(next, hops + 1).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();
          const decompress = enc.includes('gzip') || enc.includes('deflate')
            ? cb => zlib.unzip(raw, cb)
            : enc.includes('br')
            ? cb => zlib.brotliDecompress(raw, cb)
            : cb => cb(null, raw);

          decompress((err, buf) => {
            if (err) return reject(new Error(`decompress error (${enc}): ${err.message}`));
            resolve({
              statusCode:      res.statusCode,
              contentEncoding: enc,
              contentType:     res.headers['content-type'] || '',
              body:            buf.toString('utf8'),
            });
          });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
    });
  }

  // ── Step 1: fetch sitemap, grab first physical product URL ───────────────────
  diag.step = 'fetch_sitemap';
  let sitemapBody;
  try {
    const r = await rawFetch(diag.sitemap_url);
    sitemapBody = r.body;
  } catch (e) {
    diag.parse_error = `sitemap fetch failed: ${e.message}`;
    return diag;
  }

  const allUrls = sitemapBody.match(/https:\/\/www\.officedepot\.com\/a\/products\/[^<\s"]+/g) || [];
  if (!allUrls.length) {
    diag.parse_error = 'no product URLs found in sitemap';
    return diag;
  }

  // Mirror the isPhysicalProduct filter from officeDepotDiscovery.js
  const INCLUDE_KEYWORDS = [
    'laptop', 'notebook', 'chromebook', 'computer', 'desktop',
    'monitor', 'display',
    'printer', 'copier', 'scanner', 'shredder', 'laminator',
    'chair', 'desk', 'table', 'cabinet', 'shelv', 'bookcase', 'ergonomic', 'standing',
    'tablet', 'ipad', 'kindle',
    'keyboard', 'mouse', 'webcam', 'headphone', 'headset',
    'speaker', 'microphone',
    'router', 'modem', 'access-point', 'network-switch',
    'hard-drive', '-ssd-', '-ssd', 'flash-drive', 'usb-drive', 'external-drive',
    'projector', 'whiteboard', 'smartboard',
    'camera',
    'ups-', '-ups-', 'surge-protector', 'power-strip',
    'coffee-maker', 'keurig', 'coffee-machine', 'espresso',
    'tv-', '-tv-', 'television', 'smart-tv',
    'toner', 'ink-cartridge',
  ];
  function isPhysical(u) {
    const m = u.toLowerCase().match(/\/a\/products\/\d+\/([^/?#]+)/);
    if (!m) return false;
    return INCLUDE_KEYWORDS.some(kw => m[1].includes(kw));
  }

  // Prefer a URL matching the physical product filter (same as what discovery actually scrapes)
  const productUrl = allUrls.find(u => isPhysical(u)) || allUrls[0];
  diag.product_url = productUrl.split('?')[0].replace(/\/$/, '') + '/';

  // ── Step 2: fetch the product page ───────────────────────────────────────────
  diag.step = 'fetch_product_page';
  let res;
  try {
    res = await rawFetch(diag.product_url);
  } catch (e) {
    diag.parse_error = `product page fetch failed: ${e.message}`;
    return diag;
  }

  diag.http_status      = res.statusCode;
  diag.content_encoding = res.contentEncoding || '(none)';
  diag.content_type     = res.contentType;
  diag.html_length      = res.body.length;
  diag.html_first_1000  = res.body.slice(0, 1000);

  if (res.statusCode !== 200) {
    diag.parse_error = `HTTP ${res.statusCode}`;
    return diag;
  }

  const html = res.body;

  // ── Step 3: pattern checks ───────────────────────────────────────────────────
  diag.step = 'pattern_check';
  diag.homepage_redirect = html.includes('<title>Office Supplies, Furniture, Technology at Office Depot</title>');
  diag.has_ld_json       = /<script[^>]+type="application\/ld\+json"/i.test(html);
  diag.has_next_data     = html.includes('__NEXT_DATA__');
  diag.has_currentPrice  = /currentPrice|"price"\s*:/i.test(html);
  diag.has_salePrice     = /salePrice|sale_price/i.test(html);
  diag.has_offers        = /"offers"/i.test(html);
  diag.has_price_literal = /"price"\s*:\s*[\d.]+/.test(html);

  if (diag.homepage_redirect) {
    diag.parse_error = 'homepage_redirect — product discontinued';
    return diag;
  }

  // ── Step 4: LD+JSON parse (mirrors officedepot.js exactly) ───────────────────
  diag.step = 'parse_ld_json';
  const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!ldMatch) {
    // Capture a snippet around any JSON-like price data to hint at real structure
    const priceSnippet = html.match(/["']price["']\s*[:=]\s*["']?[\d.]+/i);
    diag.parse_error = `No LD+JSON found. Price snippet: ${priceSnippet ? priceSnippet[0] : '(none found)'}`;
    diag.html_first_1000 = res.body.slice(0, 1000);  // already set, for context
    return diag;
  }

  let item;
  try {
    const parsed = JSON.parse(ldMatch[1]);
    item = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    diag.parse_error = `LD+JSON parse error: ${e.message} | raw: ${ldMatch[1].slice(0, 200)}`;
    return diag;
  }

  if (!item?.offers) {
    diag.parse_error = `No offers in LD+JSON. Keys present: ${Object.keys(item || {}).join(', ')}`;
    return diag;
  }

  const offer        = Array.isArray(item.offers) ? item.offers[0] : item.offers;
  const highPriceRaw = offer?.highPrice;
  diag.parsed_name         = item.name || '';
  diag.parsed_sku          = item.sku  || item.mpn || '';
  diag.parsed_currentPrice = parseFloat(offer?.price) || null;
  diag.parsed_regularPrice = (highPriceRaw && highPriceRaw !== 'None') ? parseFloat(highPriceRaw) || null : null;
  diag.parsed_inStock      = offer?.availability?.includes('InStock') ?? false;

  if (!diag.parsed_currentPrice) {
    diag.parse_error = `offer.price is "${offer?.price}" → currentPrice=null. offer keys: ${Object.keys(offer || {}).join(', ')}`;
    return diag;
  }

  // ── Step 5: attempt saveProductData (read-only simulation — insert product then rollback) ──
  diag.step = 'save_attempt';
  diag.save_attempted = true;
  try {
    const { query } = require('./src/config/database');

    const storeRes = await query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', ['office-depot']);
    const storeId  = storeRes.rows[0]?.id;
    if (!storeId) {
      diag.save_error = 'store "office-depot" not found in DB';
      return diag;
    }

    const catRes = await query('SELECT id, slug FROM categories ORDER BY name LIMIT 1');
    const categoryId = catRes.rows[0]?.id || null;
    const catSlug    = catRes.rows[0]?.slug || null;

    const skuKey = diag.parsed_sku || `od-${diag.product_url.match(/\/a\/products\/(\d+)\//)?.[1] || 'test'}`;

    const inserted = await query(`
      INSERT INTO products (name, brand, sku, upc, store_id, category_id, image_url, product_url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (sku, store_id) DO UPDATE SET
        name=EXCLUDED.name, brand=COALESCE(EXCLUDED.brand,products.brand),
        image_url=COALESCE(EXCLUDED.image_url,products.image_url),
        product_url=COALESCE(EXCLUDED.product_url,products.product_url),
        updated_at=NOW()
      RETURNING *
    `, [
      diag.parsed_name || 'OD Diag Product',
      null,
      skuKey,
      null,
      storeId,
      categoryId,
      null,
      diag.product_url,
    ]);

    const dbProduct = { ...inserted.rows[0], cat_slug: catSlug };
    const scraped = {
      name: diag.parsed_name, brand: '', sku: diag.parsed_sku,
      currentPrice: diag.parsed_currentPrice, regularPrice: diag.parsed_regularPrice,
      inStock: diag.parsed_inStock, imageUrl: null,
      productUrl: diag.product_url, storeSlug: 'office-depot', source: 'ld+json-http',
    };

    const { saveProductData } = require('./src/services/scraperBase');
    await saveProductData(dbProduct, scraped, 'office-depot');
    diag.save_error = null;  // success
  } catch (e) {
    diag.save_error     = e.message;
    diag.save_error_sql = e.detail || e.hint || e.where || null;
  }

  diag.step = 'done';
  return diag;
}

// ─── Discovery engine loader ──────────────────────────────────────────────────
function loadEngines() {
  const engines = {};
  const paths = {
    'best-buy':       './src/services/discovery/bestBuyDiscovery',
    'target':         './src/services/discovery/targetDiscovery',
    'lowes':          './src/services/discovery/lowesDiscovery',
    'home-depot':     './src/services/discovery/homeDepotDiscovery',
    'gamestop':       './src/services/discovery/gamestopDiscovery',
    'office-depot':   './src/services/discovery/officeDepotDiscovery',
    'staples':        './src/services/discovery/staplesDiscovery',
    'nordstrom-rack': './src/services/discovery/nordstromRackDiscovery',
    'macys':          './src/services/discovery/macysDiscovery',
    'kohls':          './src/services/discovery/kohlsDiscovery',
    'tj-maxx':        './src/services/discovery/tjmaxxDiscovery',
    'marshalls':      './src/services/discovery/marshallsDiscovery',
    'burlington':     './src/services/discovery/burlingtonDiscovery',
    'costco':         './src/services/discovery/costcoDiscovery',
    'walmart':        './src/services/discovery/walmartDiscovery',
  };

  for (const [slug, path] of Object.entries(paths)) {
    try {
      engines[slug] = require(path);
    } catch {
      // Not yet implemented — skip silently
    }
  }
  return engines;
}

// ─── Run one engine safely (per-store timeout, default 10 min) ───────────────
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const STORE_TIMEOUTS_MS  = {
  'office-depot': 20 * 60 * 1000,  // sitemap + proxy scrape is slow; needs extra headroom
};

async function runEngine(engines, slug, opts, label) {
  const eng = engines[slug];
  if (!eng) return null;

  const timeoutMs = STORE_TIMEOUTS_MS[slug] || DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    console.log(`\n🏪 ${label || slug} Discovery...`);
    const fn = eng.runDiscovery
      || eng[`run${slug.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('')}Discovery`];
    if (!fn) { console.log(`  ⚠️  No runDiscovery export for ${slug}`); return null; }
    const s = await Promise.race([
      fn(opts),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Store timeout after ${timeoutMs / 60000}min`)), timeoutMs)),
    ]);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const blocked  = s.blocked ? ` ⛔BLOCKED(${s.blockType || '?'})` : '';
    const errInfo  = s.last_error ? ` last_error="${s.last_error}"` : '';
    console.log(`   [${slug}] pages:${s.pages_visited||0} found:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0} elapsed:${elapsed}s${blocked}${errInfo}`);
    return s;
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`  ❌ [${slug}] EXCEPTION after ${elapsed}s: ${e.message}`);
    if (e.stack) console.error(`     ${e.stack.split('\n')[1]?.trim()}`);
    return { errors: 1, last_error: e.message, saved: 0, blocked: false };
  }
}

// ─── Startup diagnostics ─────────────────────────────────────────────────────
async function logStartup() {
  const dbUrl = process.env.DATABASE_URL || '';
  let dbHost = '(DATABASE_URL not set)';
  let dbName = '(unknown)';
  try {
    const u = new URL(dbUrl);
    dbHost = u.hostname;
    dbName = u.pathname.replace(/^\//, '') || '(empty)';
  } catch {}

  const pUser = process.env.PROXY_USER || '';
  const ispUser = process.env.ISP_PROXY_USER || '';

  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║  WORKER STARTUP DIAGNOSTICS' + ' '.repeat(30) + '║');
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log(`║  NODE_ENV           : ${(process.env.NODE_ENV        || 'not set').padEnd(33)}║`);
  console.log(`║  DB host            : ${dbHost.padEnd(33)}║`);
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log('║  ── PROXY (residential) ──────────────────────────────║');
  console.log(`║  PROXY_ENABLED      : ${(process.env.PROXY_ENABLED   || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_HOST         : ${(process.env.PROXY_HOST      || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_PORT         : ${(process.env.PROXY_PORT      || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_USER         : ${(pUser ? pUser.slice(0, 33) : 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_USER (full)  : ${(pUser || 'not set').padEnd(33)}║`);
  console.log(`║  PROXY_PASS         : ${(process.env.PROXY_PASS ? '***set***' : 'not set').padEnd(33)}║`);
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log('║  ── ISP PROXY ────────────────────────────────────────║');
  console.log(`║  ISP_PROXY_ENABLED  : ${(process.env.ISP_PROXY_ENABLED  || 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_HOST     : ${(process.env.ISP_PROXY_HOST     || 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_PORT     : ${(process.env.ISP_PROXY_PORT     || 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_USER     : ${(ispUser ? ispUser.slice(0, 33) : 'not set').padEnd(33)}║`);
  console.log(`║  ISP_PROXY_PASS     : ${(process.env.ISP_PROXY_PASS ? '***set***' : 'not set').padEnd(33)}║`);
  console.log('╠' + '═'.repeat(58) + '╣');

  // Immediate connectivity test via configured proxy
  const https = require('https');
  async function testIp(label, agentOpts) {
    return new Promise(resolve => {
      const opts = { timeout: 10000, rejectUnauthorized: false, ...agentOpts };
      const req = https.get('https://api.ipify.org?format=json', opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(`${label}: OK ip=${JSON.parse(Buffer.concat(chunks).toString()).ip}`); }
          catch { resolve(`${label}: OK (parse error)`); }
        });
      });
      req.on('error', e => resolve(`${label}: FAIL ${e.message}`));
      req.on('timeout', () => { req.destroy(); resolve(`${label}: TIMEOUT`); });
    });
  }

  // Direct
  const directResult = await testIp('DIRECT', {});
  console.log(`║  ${directResult.padEnd(55)}║`);

  // Residential proxy test
  if (process.env.PROXY_ENABLED === 'true' && pUser && process.env.PROXY_PASS) {
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
      const url = `http://${pUser}:${process.env.PROXY_PASS}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
      const agent = new Ctor(url, { rejectUnauthorized: false });
      const r = await testIp(`PROXY ${process.env.PROXY_PORT}`, { agent });
      console.log(`║  ${r.padEnd(55)}║`);
    } catch (e) {
      console.log(`║  PROXY_MAIN: AGENT_INIT_FAIL ${e.message.slice(0, 26).padEnd(27)}║`);
    }
  }

  // ISP proxy test
  if (ispUser && process.env.ISP_PROXY_PASS) {
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
      const url = `http://${ispUser}:${process.env.ISP_PROXY_PASS}@${process.env.ISP_PROXY_HOST}:${process.env.ISP_PROXY_PORT}`;
      const agent = new Ctor(url, { rejectUnauthorized: false });
      const r = await testIp(`ISP ${process.env.ISP_PROXY_PORT}`, { agent });
      console.log(`║  ${r.padEnd(55)}║`);
    } catch (e) {
      console.log(`║  ISP_PROXY: AGENT_INIT_FAIL ${e.message.slice(0, 27).padEnd(27)}║`);
    }
  }

  console.log('╠' + '═'.repeat(58) + '╣');
  try {
    const p = await query('SELECT COUNT(*) AS cnt FROM products');
    const d = await query('SELECT COUNT(*) AS cnt FROM deals WHERE is_active = true');
    console.log(`║  DB products        : ${String(p.rows[0].cnt).padEnd(33)}║`);
    console.log(`║  DB active deals    : ${String(d.rows[0].cnt).padEnd(33)}║`);
    console.log(`║  DB STATUS          : ${'CONNECTED ✓'.padEnd(33)}║`);
  } catch (e) {
    console.log(`║  DB STATUS          : ${'ERROR: '.concat(e.message).slice(0, 33).padEnd(33)}║`);
  }
  console.log('╚' + '═'.repeat(58) + '╝');
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  banner('🚀 DEAL HUNTER — LIVE DISCOVERY v3');
  await logStartup();

  // Start the price-scan cron job here — web service no longer runs it.
  const { startScanJob } = require('./src/jobs/scanJob');
  startScanJob();
  console.log('  ✅ Scan job cron started (price re-scan every ~30 min)');

  // ── Discovery job queue poller ────────────────────────────────────────────────
  // Web service enqueues jobs via POST /api/admin/discovery-jobs.
  // Worker polls every 45s and executes them between cycles (no Playwright on web).
  const engines = loadEngines();
  setInterval(async () => {
    try {
      const job = await claimNextPendingJob();
      if (!job) return;
      console.log(`\n[JobQueue] Claimed job #${job.id}: ${job.store_slug} (requested by ${job.requested_by || 'system'})`);

      let result;
      if (job.store_slug === 'worker-proxy-test') {
        result = await runWorkerProxyTest();
      } else if (job.store_slug === 'od-product-diag') {
        result = await runOdProductDiag();
      } else {
        result = await runEngine(engines, job.store_slug, { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, job.store_slug);
      }

      await markCompleted(job.id, result || {});
      console.log(`[JobQueue] Job #${job.id} completed — saved:${result?.saved || 0} errors:${result?.errors || 0}`);
    } catch (err) {
      console.error(`[JobQueue] Poller error: ${err.message}`);
      // Mark the job failed so it doesn't stay stuck in 'running' and block re-queuing
      if (typeof job !== 'undefined' && job?.id) {
        await markFailed(job.id, err.message).catch(() => {});
      }
    }
  }, 45 * 1000);
  console.log('  ✅ Discovery job queue poller started (checks every 45s)');

  console.log(`  Engines loaded: ${Object.keys(engines).join(', ')}`);
  console.log(`  Cycle interval: 30 min`);

  while (true) {
    cycleCount++;
    const cycleStart = Date.now();
    banner(`🔄 CYCLE #${cycleCount} — ${new Date().toLocaleTimeString()}`);

    const cycleStats = {};

    // ── Tier 1: Stable direct-connection stores ───────────────────────────────

    // Best Buy (link fallback, highly reliable)
    if (engines['best-buy']) {
      try {
        console.log('\n🟦 Best Buy Discovery...');
        const s = await engines['best-buy'].runBestBuyDiscovery({
          maxTotal: 500, maxPerSearch: 30, delayMs: 1200,
        });
        cycleStats['best-buy'] = s;
        console.log(`   discovered:${s.urls_discovered||s.cards_found||0} saved:${s.saved||0} errors:${s.errors||0}`);
      } catch (e) { console.error('  ❌ Best Buy error:', e.message); }
    }

    // Target (SPA — early-exit after 3 empty pages, rescans existing products)
    if (engines['target']) {
      try {
        console.log('\n🎯 Target Discovery...');
        const s = await engines['target'].runTargetDiscovery({
          maxTotal: 500, maxPerPage: 50, delayMs: 1200,
        });
        cycleStats['target'] = s;
        console.log(`   discovered:${s.urls_discovered||0} new:${s.urls_new||0} saved:${s.saved||0} errors:${s.errors||0}`);
      } catch (e) { console.error('  ❌ Target error:', e.message); }
    }

    // Tier 1 direct stores — Office Depot runs early (sitemap-based, fast to discover)
    cycleStats['office-depot'] = await runEngine(engines, 'office-depot', { maxTotal: 150, maxPerPage: 30, delayMs: 1000 }, 'Office Depot');
    cycleStats['lowes']        = await runEngine(engines, 'lowes',        { maxTotal: 150, maxPerPage: 30, delayMs: 2500 }, "Lowe's");
    cycleStats['home-depot']   = await runEngine(engines, 'home-depot',   { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Home Depot');
    cycleStats['gamestop']     = await runEngine(engines, 'gamestop',     { maxTotal: 200, maxPerPage: 30, delayMs: 2000 }, 'GameStop');
    cycleStats['staples']      = await runEngine(engines, 'staples',      { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Staples');

    // ── Tier 2: Residential proxy stores ─────────────────────────────────────
    // Max 1-2 Akamai attempts (controlled by proxyManager)

    cycleStats['nordstrom-rack'] = await runEngine(engines, 'nordstrom-rack', { maxTotal: 120, maxPerPage: 25, delayMs: 2500 }, 'Nordstrom Rack');
    // Macy's uses SPA interception (no proxy) — maxPerPage not applicable
    cycleStats['macys']          = await runEngine(engines, 'macys',          { maxTotal: 120, delayMs: 800 }, "Macy's");

    // ── Tier 3: Akamai-protected (limited attempts) ───────────────────────────
    // proxyManager.shouldSkipStore() gates these if too many failures occurred
    // maxConsecutiveEmpty=2 inside each engine gives up after 2 blocked pages

    cycleStats['kohls']      = await runEngine(engines, 'kohls',      { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, "Kohl's");
    cycleStats['tj-maxx']    = await runEngine(engines, 'tj-maxx',    { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, 'TJ Maxx');
    cycleStats['marshalls']  = await runEngine(engines, 'marshalls',  { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, 'Marshalls');
    cycleStats['burlington'] = await runEngine(engines, 'burlington', { maxTotal: 100, maxPerPage: 25, delayMs: 3000 }, 'Burlington');

    // Optional: Costco (direct, lower priority)
    cycleStats['costco']   = await runEngine(engines, 'costco',   { maxTotal: 100, maxPerPage: 25, delayMs: 2500 }, 'Costco');

    // Walmart — residential proxy, Akamai may block
    cycleStats['walmart']  = await runEngine(engines, 'walmart',  { maxTotal: 150, maxPerPage: 30, delayMs: 2000 }, 'Walmart');

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await cleanupDeals().catch(e => console.error('Cleanup error:', e.message));

    // ── Price change detection ────────────────────────────────────────────────
    try {
      const changeStats = await detectRecentChanges();
      if (changeStats.total > 0) {
        console.log(`\n📉 Price changes: ${changeStats.markdowns} markdowns, ${changeStats.pennies} penny items`);
      }
    } catch (e) { console.error('Price detection error:', e.message); }

    // ── Alert engine ──────────────────────────────────────────────────────────
    try {
      const alertStats = await runAlertEngine();
      if (alertStats.watchlist?.triggered > 0 || alertStats.configured?.triggered > 0) {
        console.log(`\n🔔 Alerts fired: watchlist=${alertStats.watchlist?.triggered} configured=${alertStats.configured?.triggered}`);
      }
    } catch (e) { console.error('Alert engine error:', e.message); }

    // ── DB Stats summary ──────────────────────────────────────────────────────
    try {
      const stats = await getStats();
      console.log('\n📊 DATABASE SUMMARY:');
      console.log('  ' + ['Store','Products','Active Deals','Avg Discount','Avg ROI'].map(h=>h.padEnd(16)).join(''));
      for (const s of stats) {
        console.log('  ' + [
          s.slug, s.total_products, s.active_deals,
          s.avg_discount ? s.avg_discount + '%' : '—',
          s.avg_roi ? s.avg_roi + '%' : '—',
        ].map(v => String(v).padEnd(16)).join(''));
      }
    } catch (e) { console.error('Stats error:', e.message); }

    // ── Cycle summary ─────────────────────────────────────────────────────────
    const blockedStores = Object.entries(cycleStats).filter(([,s]) => s?.blocked).map(([k]) => k);
    if (blockedStores.length) {
      console.log(`\n⛔ Blocked stores this cycle: ${blockedStores.join(', ')}`);
    }

    const savedThisCycle = Object.values(cycleStats).reduce((sum, s) => sum + (s?.saved || 0), 0);
    try {
      const p = await query('SELECT COUNT(*) AS cnt FROM products');
      const d = await query('SELECT COUNT(*) AS cnt FROM deals WHERE is_active = true');
      console.log(`\n📈 DB after cycle #${cycleCount}: products=${p.rows[0].cnt} active_deals=${d.rows[0].cnt} saved_this_cycle=${savedThisCycle}`);
    } catch {}

    const elapsed = Math.round((Date.now() - cycleStart) / 1000);
    console.log(`\n⏱️  Cycle #${cycleCount} completed in ${elapsed}s. Next cycle in 30 min...`);

    // Restart browser pool every N cycles (reclaims Chromium memory)
    if (cycleCount % POOL_RESTART_EVERY === 0) {
      console.log('\n♻️  Restarting browser pool (memory maintenance)...');
      await restartBrowserPool().catch(e => console.error('Pool restart error:', e.message));
    }

    await sleep(30 * 60 * 1000);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

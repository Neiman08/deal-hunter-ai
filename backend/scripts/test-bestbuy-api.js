/**
 * test-bestbuy-api.js — Non-Playwright BB product data probe
 *
 * Tests multiple HTTP-only approaches to extract price/product data from Best Buy.
 * Run on Render worker: node backend/scripts/test-bestbuy-api.js
 *
 * Approaches per product:
 *   1. Direct GET → page HTML → JSON-LD + embedded JS state
 *   2. Falcor model.json API (skuId required)
 *   3. Availability/fulfillment API (skuId required)
 *   4. Direct GET via BrightData ISP proxy (if credentials in env)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const https = require('https');
const zlib  = require('zlib');

const TEST_PRODUCTS = [
  {
    label : 'Philips Espresso — /product/.../sku/12569793',
    url   : 'https://www.bestbuy.com/product/philips-5500-fully-automatic-espresso-machine-with-lattego-milk-frother-grey-chrome-black-silver/JJG3876CY2/sku/12569793',
    alphaId: 'JJG3876CY2',
    sku   : '12569793',
  },
  {
    label : 'Samsung Monitor — /product/.../JJGRF33PPV (no /sku/)',
    url   : 'https://www.bestbuy.com/product/samsung-37-odyssey-g75f-4k-165hz-1ms-amd-freesync-prem-pro-curved-gaming-monitor-with-hdr-600-displayport-hdmi-black/JJGRF33PPV',
    alphaId: 'JJGRF33PPV',
    sku   : null,
  },
];

const BASE_HEADERS = {
  'User-Agent'               : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language'          : 'en-US,en;q=0.9',
  'Accept-Encoding'          : 'gzip, deflate',
  'Connection'               : 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest'           : 'document',
  'Sec-Fetch-Mode'           : 'navigate',
  'Sec-Fetch-Site'           : 'none',
  'Sec-Fetch-User'           : '?1',
  'DNT'                      : '1',
};

const JSON_HEADERS = {
  'User-Agent'    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept'        : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Connection'    : 'keep-alive',
  'Referer'       : 'https://www.bestbuy.com/',
  'Origin'        : 'https://www.bestbuy.com',
};

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpGet(urlStr, headers = {}, agent = null, hops = 0) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const u    = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path    : u.pathname + u.search,
      method  : 'GET',
      headers : { host: u.hostname, ...headers },
      rejectUnauthorized: false,
      timeout : 20000,
    };
    if (agent) opts.agent = agent;

    const req = https.request(opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc  = res.headers.location;
        const next = loc.startsWith('http') ? loc : `https://${u.hostname}${loc}`;
        const cook = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        const merged = { ...headers };
        if (cook) merged.cookie = cook;
        return httpGet(next, merged, agent, hops + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        const decompress = enc.includes('gzip') || enc.includes('deflate')
          ? cb => zlib.unzip(raw, cb)
          : cb => cb(null, raw);
        decompress((err, buf) => {
          if (err) return reject(err);
          resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8') });
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function buildIspAgent() {
  const host = process.env.ISP_PROXY_HOST || process.env.PROXY_HOST;
  const user = process.env.ISP_PROXY_USER;
  const pass = process.env.ISP_PROXY_PASS;
  const port = parseInt(process.env.ISP_PROXY_PORT) || 33335;
  if (!user || !pass || !host) return null;
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(`http://${user}:${pass}@${host}:${port}`, { rejectUnauthorized: false });
  } catch { return null; }
}

// ─── Extraction helpers ───────────────────────────────────────────────────────

function extractJsonLd(html) {
  const results = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])); } catch {}
  }
  return results;
}

function extractEmbeddedState(html) {
  const patterns = [
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]+?});\s*(?:\/\/|window\.|<\/script>)/,
    /window\.APP_PRELOADED_STATE\s*=\s*({[\s\S]+?});\s*(?:\/\/|window\.|<\/script>)/,
    /window\.initialData\s*=\s*({[\s\S]+?});\s*(?:\/\/|window\.|<\/script>)/,
    /window\.__BB_STATE__\s*=\s*({[\s\S]+?});\s*(?:\/\/|window\.|<\/script>)/,
    /window\.digitalData\s*=\s*({[\s\S]+?});\s*(?:\/\/|window\.|<\/script>)/,
    /"currentPrice"\s*:\s*([\d.]+)/,
    /"salePrice"\s*:\s*([\d.]+)/,
    /"regularPrice"\s*:\s*([\d.]+)/,
  ];

  const found = {};
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      const key = pat.toString().match(/window\.(\w+)/)?.[1] || pat.toString().match(/"(\w+)"/)?.[1] || 'unknown';
      found[key] = m[1]?.slice(0, 200);
    }
  }
  return found;
}

function extractProductFromJsonLd(jsonldBlocks) {
  for (const block of jsonldBlocks) {
    const item = Array.isArray(block) ? block[0] : block;
    if (item?.['@type'] === 'Product') {
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      return {
        name          : item.name,
        sku           : item.sku || item.productID,
        brand         : item.brand?.name || item.brand,
        imageUrl      : Array.isArray(item.image) ? item.image[0] : item.image,
        currentPrice  : offer?.price ? parseFloat(offer.price) : null,
        regularPrice  : null,
        availability  : offer?.availability,
        currency      : offer?.priceCurrency,
        description   : item.description?.slice(0, 100),
      };
    }
  }
  return null;
}

function diagnoseHtml(html) {
  if (!html || html.length < 200) return 'EMPTY (< 200 chars)';
  const lower = html.toLowerCase();
  if (/captcha|robot check|verify you are human/i.test(html)) return 'CAPTCHA / bot check';
  if (/access denied|403 forbidden/i.test(html)) return 'ACCESS DENIED';
  if (/chrome-error:\/\//.test(html)) return 'CHROME ERROR PAGE (Playwright artefact)';
  if (lower.includes('<div id="app"') && !lower.includes('"currentprice"') && !lower.includes('"@type":"product"')) {
    return 'REACT SHELL (empty SPA, no preloaded state)';
  }
  if (lower.includes('"@type":"product"') || lower.includes('"currentprice"')) {
    return 'FULL HTML with product data';
  }
  return `HTML present (${html.length} chars) — content unclear`;
}

// ─── Approach 2: Falcor model.json API ───────────────────────────────────────

// BB Falcor paths to try (in order of likelihood)
const FALCOR_PATH_SETS = [
  {
    label: 'pdp.skuId pricing/availability',
    paths: (sku) => [
      ['shop', 'pdp', 'skuId', sku, 'pricing'],
      ['shop', 'pdp', 'skuId', sku, 'availability'],
    ],
  },
  {
    label: 'pdp.skuId skuInfo',
    paths: (sku) => [
      ['shop', 'pdp', 'skuId', sku, 'skuInfo'],
    ],
  },
  {
    label: 'pdp.skuId summary',
    paths: (sku) => [
      ['shop', 'pdp', 'skuId', sku, 'summary'],
    ],
  },
  {
    label: 'pdp.skuId priceBlock',
    paths: (sku) => [
      ['shop', 'pdp', 'skuId', sku, 'priceBlock'],
    ],
  },
];

function deepGet(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

async function tryFalcorApi(sku, agent) {
  const results = [];

  for (const pathSet of FALCOR_PATH_SETS) {
    const paths = JSON.stringify(pathSet.paths(sku));
    const url   = `https://www.bestbuy.com/api/tcfb/model.json?paths=${encodeURIComponent(paths)}&method=get`;

    try {
      const res = await httpGet(url, { ...JSON_HEADERS, 'Accept': 'application/json' }, agent);
      if (res.status !== 200) {
        results.push({ label: pathSet.label, ok: false, status: res.status });
        continue;
      }

      let json;
      try { json = JSON.parse(res.body); } catch {
        results.push({ label: pathSet.label, ok: false, parseError: true, rawStart: res.body.slice(0, 200) });
        continue;
      }

      // BB Falcor wraps everything under jsonGraph
      const graph   = json?.jsonGraph || json;
      const skuData = deepGet(graph, 'shop', 'pdp', 'skuId', sku);
      const rawBody = res.body.slice(0, 1500);

      results.push({
        label      : pathSet.label,
        ok         : true,
        topKeys    : Object.keys(json || {}).join(', '),
        graphKeys  : Object.keys(graph?.shop?.pdp?.skuId?.[sku] || {}).join(', '),
        skuData    : skuData ? JSON.stringify(skuData).slice(0, 400) : '(null)',
        rawBody    : rawBody,
      });

      // Stop if we found actual data (non-empty skuData)
      if (skuData && JSON.stringify(skuData) !== '{}') break;
    } catch (err) {
      results.push({ label: pathSet.label, ok: false, error: err.message });
    }
  }

  return results;
}

// ─── Approach 3: Availability API ────────────────────────────────────────────

async function tryAvailabilityApi(sku, agent) {
  const url = `https://www.bestbuy.com/api/1.0/pdp/fulfillment/client-side-availability?skuIds=${sku}`;
  const res  = await httpGet(url, JSON_HEADERS, agent);
  if (res.status !== 200) return { ok: false, status: res.status };
  try {
    const json = JSON.parse(res.body);
    return { ok: true, data: json };
  } catch {
    return { ok: false, parseError: true, body: res.body.slice(0, 200) };
  }
}

// ─── Approach 4: Product search JSON endpoint ─────────────────────────────────

async function trySearchJsonApi(term, agent) {
  const url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(term)}&format=json&cp=1&pageSize=1`;
  const res  = await httpGet(url, JSON_HEADERS, agent);
  if (res.status !== 200) return { ok: false, status: res.status, body: res.body.slice(0, 200) };
  try {
    const json = JSON.parse(res.body);
    const product = json?.results?.[0] || json?.products?.[0] || json?.searchResults?.products?.[0];
    return { ok: true, product, topKeys: Object.keys(json || {}).slice(0, 15) };
  } catch {
    return { ok: false, parseError: true, rawStart: res.body.slice(0, 300) };
  }
}

// ─── Approach 5: Suggestions / autocomplete API ───────────────────────────────

async function trySuggestApi(alphaId, agent) {
  const url = `https://www.bestbuy.com/site/api/suggestions?query=${encodeURIComponent(alphaId)}&includedTypes=product`;
  const res  = await httpGet(url, JSON_HEADERS, agent);
  if (res.status !== 200) return { ok: false, status: res.status };
  try {
    const json = JSON.parse(res.body);
    return { ok: true, data: json };
  } catch {
    return { ok: false, parseError: true };
  }
}

// ─── Main probe ───────────────────────────────────────────────────────────────

async function probeProduct(product, ispAgent) {
  const sep = '─'.repeat(60);
  console.log(`\n${sep}`);
  console.log(`  PRODUCT: ${product.label}`);
  console.log(`  URL: ${product.url}`);
  console.log(sep);

  // ── APPROACH 1A: Direct GET (no proxy) ──
  console.log('\n[1A] Direct HTTP GET (no proxy)…');
  let htmlRes;
  try {
    htmlRes = await httpGet(product.url, BASE_HEADERS, null);
    const diagnosis = diagnoseHtml(htmlRes.body);
    console.log(`     → status: ${htmlRes.status} | diagnosis: ${diagnosis}`);
    console.log(`     → bodyLen: ${htmlRes.body.length} chars`);
    console.log(`     → finalUrl: ${htmlRes.headers?.location || '(no redirect)'}`);

    const jsonldBlocks = extractJsonLd(htmlRes.body);
    console.log(`     → JSON-LD blocks found: ${jsonldBlocks.length}`);
    if (jsonldBlocks.length > 0) {
      const productData = extractProductFromJsonLd(jsonldBlocks);
      if (productData) {
        console.log('     → ✅ Product data from JSON-LD:');
        console.log(`        name:         ${productData.name?.slice(0, 60)}`);
        console.log(`        sku:          ${productData.sku}`);
        console.log(`        brand:        ${productData.brand}`);
        console.log(`        currentPrice: ${productData.currentPrice}`);
        console.log(`        availability: ${productData.availability}`);
        console.log(`        imageUrl:     ${productData.imageUrl?.slice(0, 60)}`);
      } else {
        console.log(`     → JSON-LD types: ${jsonldBlocks.map(b => b?.['@type'] || b?.[0]?.['@type'] || '?').join(', ')}`);
      }
    }

    const embedded = extractEmbeddedState(htmlRes.body);
    if (Object.keys(embedded).length > 0) {
      console.log('     → Embedded JS state patterns found:');
      for (const [k, v] of Object.entries(embedded)) {
        console.log(`        ${k}: ${String(v).slice(0, 100)}`);
      }
    } else {
      console.log('     → No embedded JS state found');
    }

    // Show a 200-char snippet of body to diagnose
    console.log(`     → Body snippet: ${htmlRes.body.replace(/\s+/g, ' ').slice(0, 250)}`);

  } catch (err) {
    console.log(`     → ❌ ERROR: ${err.message}`);
    htmlRes = null;
  }

  // ── APPROACH 1B: Direct GET via ISP proxy ──
  if (ispAgent) {
    console.log('\n[1B] Direct HTTP GET (ISP proxy)…');
    try {
      const proxyRes = await httpGet(product.url, BASE_HEADERS, ispAgent);
      const diagnosis = diagnoseHtml(proxyRes.body);
      console.log(`     → status: ${proxyRes.status} | diagnosis: ${diagnosis}`);
      console.log(`     → bodyLen: ${proxyRes.body.length} chars`);

      const jsonldBlocks = extractJsonLd(proxyRes.body);
      console.log(`     → JSON-LD blocks: ${jsonldBlocks.length}`);
      if (jsonldBlocks.length > 0) {
        const pd = extractProductFromJsonLd(jsonldBlocks);
        if (pd) {
          console.log('     → ✅ Product via proxy JSON-LD:');
          console.log(`        name:  ${pd.name?.slice(0, 60)}`);
          console.log(`        price: ${pd.currentPrice}`);
          console.log(`        sku:   ${pd.sku}`);
        }
      }

      const embedded = extractEmbeddedState(proxyRes.body);
      if (Object.keys(embedded).length > 0) {
        console.log('     → Proxy embedded state:', JSON.stringify(embedded).slice(0, 200));
      }

      console.log(`     → Body snippet: ${proxyRes.body.replace(/\s+/g, ' ').slice(0, 250)}`);
    } catch (err) {
      console.log(`     → ❌ ERROR: ${err.message}`);
    }
  } else {
    console.log('\n[1B] ISP proxy — skipped (no credentials in env)');
  }

  // ── APPROACH 2: Falcor model.json API ──
  if (product.sku) {
    console.log(`\n[2A] Falcor model.json API — skuId=${product.sku} (no proxy)…`);
    try {
      const results = await tryFalcorApi(product.sku, null);
      for (const r of results) {
        const icon = r.ok ? '✅' : '❌';
        console.log(`     ${icon} [${r.label}]`);
        if (r.ok) {
          console.log(`        topKeys:   ${r.topKeys}`);
          console.log(`        graphKeys: ${r.graphKeys}`);
          console.log(`        skuData:   ${r.skuData}`);
          console.log(`        rawBody:   ${r.rawBody}`);
        } else {
          console.log(`        status: ${r.status || 'N/A'} | error: ${r.error || ''} | parseError: ${r.parseError || ''}`);
          if (r.rawStart) console.log(`        rawStart: ${r.rawStart}`);
        }
      }
    } catch (err) {
      console.log(`     → ❌ ERROR: ${err.message}`);
    }
  } else {
    console.log('\n[2] Falcor API — skipped (no numeric skuId for this product)');
  }

  // ── APPROACH 3: Availability API ──
  if (product.sku) {
    console.log(`\n[3A] Availability API — skuId=${product.sku} (no proxy)…`);
    try {
      const result = await tryAvailabilityApi(product.sku, null);
      console.log(`     → ok: ${result.ok} | status: ${result.status || 'N/A'}`);
      if (result.ok) console.log(`     → ✅ data: ${JSON.stringify(result.data).slice(0, 300)}`);
      else console.log(`        body: ${result.body}`);
    } catch (err) {
      console.log(`     → ❌ ERROR: ${err.message}`);
    }
  }

  // ── APPROACH 4: Search JSON API ──
  const searchTerm = product.sku || product.alphaId;
  console.log(`\n[4A] Search JSON API — term="${searchTerm}" (no proxy)…`);
  try {
    const result = await trySearchJsonApi(searchTerm, null);
    console.log(`     → ok: ${result.ok} | status: ${result.status || 'N/A'}`);
    if (result.ok) {
      console.log(`     → topKeys: ${result.topKeys?.join(', ')}`);
      if (result.product) {
        console.log('     → ✅ Product found:');
        console.log(`        ${JSON.stringify(result.product).slice(0, 300)}`);
      } else {
        console.log('     → No product in response');
      }
    } else {
      console.log(`        parseError: ${result.parseError} | rawStart: ${result.rawStart?.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`     → ❌ ERROR: ${err.message}`);
  }

  // ── APPROACH 5: Suggestions API ──
  console.log(`\n[5A] Suggestions API — id="${product.alphaId}" (no proxy)…`);
  try {
    const result = await trySuggestApi(product.alphaId, null);
    console.log(`     → ok: ${result.ok} | status: ${result.status || 'N/A'}`);
    if (result.ok) console.log(`     → ✅ data: ${JSON.stringify(result.data).slice(0, 300)}`);
    else console.log(`        parseError: ${result.parseError}`);
  } catch (err) {
    console.log(`     → ❌ ERROR: ${err.message}`);
  }
}

// ─── Approach 6: Patchright browser page load ────────────────────────────────

async function tryPatchright(url) {
  let patchrightMod;
  try {
    patchrightMod = require('patchright');
  } catch {
    return { ok: false, error: 'patchright module not found' };
  }

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    require('path').join(__dirname, '../pw-browsers');

  const { chromium } = patchrightMod;
  let browser, ctx, page;
  try {
    const isLinux = process.platform === 'linux';
    const args    = isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
    browser = await chromium.launch({ headless: true, args });
    ctx     = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport  : { width: 1920, height: 1080 },
      locale    : 'en-US',
      timezoneId: 'America/Chicago',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    page = await ctx.newPage();

    const t0  = Date.now();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const ms  = Date.now() - t0;

    const finalUrl = page.url();
    const title    = await page.title();
    const bodyLen  = (await page.content()).length;

    // Extract price via page.evaluate
    const priceData = await page.evaluate(() => {
      // Try JSON-LD first
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const d = JSON.parse(s.textContent);
          const item = Array.isArray(d) ? d[0] : d;
          if (item?.['@type'] === 'Product') {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            return { source: 'json-ld', name: item.name, sku: item.sku, price: offer?.price, availability: offer?.availability };
          }
        } catch {}
      }

      // Try data attributes
      const priceEl = document.querySelector('[data-testid*="price"] [aria-hidden="true"], .priceView-customer-price span, [class*="priceView"] span');
      if (priceEl) return { source: 'dom', price: priceEl.textContent.trim() };

      // Try embedded state
      const scripts = [...document.querySelectorAll('script:not([src])')];
      for (const s of scripts) {
        const m = s.textContent.match(/"currentPrice"\s*:\s*([\d.]+)/);
        if (m) return { source: 'embedded-js', price: parseFloat(m[1]) };
      }

      return null;
    }).catch(() => null);

    return {
      ok      : true,
      status  : res?.status(),
      ms,
      finalUrl,
      title   : title.slice(0, 80),
      bodyLen,
      priceData,
      blocked : /captcha|robot|access denied/i.test(title) || bodyLen < 500,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await page?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

// ─── Approach 7: Patchright + ISP proxy ──────────────────────────────────────

async function tryPatchrightWithIspProxy(url) {
  let patchrightMod;
  try {
    patchrightMod = require('patchright');
  } catch {
    return { ok: false, error: 'patchright module not found' };
  }

  const host = process.env.ISP_PROXY_HOST;
  const port = process.env.ISP_PROXY_PORT || '33335';
  const user = process.env.ISP_PROXY_USER;
  const pass = process.env.ISP_PROXY_PASS;

  if (!host || !user || !pass) {
    return { ok: false, error: 'ISP_PROXY credentials missing in env' };
  }

  const proxyConfig = {
    server  : `http://${host}:${port}`,
    username: user,
    password: pass,
  };

  const { chromium } = patchrightMod;
  let browser, ctx, page;
  const isLinux = process.platform === 'linux';
  const args    = [
    '--ignore-certificate-errors',
    ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  ];

  try {
    browser = await chromium.launch({ headless: true, args, proxy: proxyConfig });
    ctx     = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport  : { width: 1920, height: 1080 },
      locale    : 'en-US',
      timezoneId: 'America/Chicago',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
    });

    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin',   filename: 'internal-pdf-viewer',             description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer',   filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client',       filename: 'internal-nacl-plugin',             description: '' },
        ],
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {}, loadTimes: function() { return {}; }, csi: function() { return {}; } };
    });

    page = await ctx.newPage();

    const t0  = Date.now();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ms  = Date.now() - t0;

    const finalUrl = page.url();
    const title    = await page.title();
    const bodyLen  = (await page.content()).length;

    const priceData = await page.evaluate(() => {
      // JSON-LD first
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const d    = JSON.parse(s.textContent);
          const item = Array.isArray(d) ? d[0] : d;
          if (item?.['@type'] === 'Product') {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            return {
              source      : 'json-ld',
              name        : item.name?.slice(0, 80),
              sku         : item.sku || item.productID,
              brand       : item.brand?.name || item.brand,
              price       : offer?.price ? parseFloat(offer.price) : null,
              regularPrice: null,
              availability: offer?.availability,
              imageUrl    : Array.isArray(item.image) ? item.image[0] : item.image,
            };
          }
        } catch {}
      }

      // Embedded JS state
      for (const s of document.querySelectorAll('script:not([src])')) {
        const m = s.textContent.match(/"currentPrice"\s*:\s*([\d.]+)/);
        if (m) return { source: 'embedded-js', price: parseFloat(m[1]) };
      }

      // DOM price element
      const el = document.querySelector(
        '.priceView-customer-price span, [data-testid*="price-block"] span, [class*="PriceBlock"] span'
      );
      if (el?.textContent?.trim()) return { source: 'dom', price: el.textContent.trim() };

      return null;
    }).catch(() => null);

    const isBlocked = /captcha|robot|access denied|verify you are/i.test(title) ||
                      /captcha|robot|access denied/i.test(finalUrl) ||
                      bodyLen < 500;

    return {
      ok        : true,
      status    : res?.status(),
      ms,
      finalUrl  : finalUrl.slice(0, 100),
      title     : title.slice(0, 80),
      bodyLen,
      blocked   : isBlocked,
      priceData,
    };
  } catch (err) {
    return { ok: false, error: err.message.split('\n')[0] };
  } finally {
    await page?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('  Best Buy API Probe — Non-Playwright');
  console.log('═'.repeat(60));

  const ispAgent = buildIspAgent();
  console.log(`\nISP Proxy: ${ispAgent ? '✅ configured' : '❌ not configured (ISP_PROXY_USER missing)'}`);
  console.log(`Residential Proxy: ${process.env.PROXY_ENABLED === 'true' ? '✅ enabled' : '❌ not enabled'}`);

  for (const product of TEST_PRODUCTS) {
    await probeProduct(product, ispAgent);
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── APPROACH 6: Patchright browser test ──
  console.log('\n' + '═'.repeat(60));
  console.log('  APPROACH 6 — Patchright browser (stealth Chromium)');
  console.log('═'.repeat(60));

  for (const product of TEST_PRODUCTS) {
    console.log(`\n[6] Patchright: ${product.label}`);
    try {
      const result = await tryPatchright(product.url);
      if (!result.ok) {
        console.log(`     → ❌ ${result.error}`);
        continue;
      }
      const icon = result.blocked ? '⚠️  BLOCKED' : result.priceData ? '✅ SUCCESS' : '⚠️  NO PRICE';
      console.log(`     → ${icon}`);
      console.log(`        status:   ${result.status} | ms: ${result.ms}`);
      console.log(`        title:    ${result.title}`);
      console.log(`        bodyLen:  ${result.bodyLen}`);
      console.log(`        price:    ${JSON.stringify(result.priceData)}`);
      console.log(`        url:      ${result.finalUrl?.slice(0, 80)}`);
    } catch (err) {
      console.log(`     → ❌ ERROR: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  // ── APPROACH 7: Patchright + ISP proxy ──
  console.log('\n' + '═'.repeat(60));
  console.log('  APPROACH 7 — Patchright + ISP proxy (BrightData static US IP)');
  console.log('═'.repeat(60));

  for (const product of TEST_PRODUCTS) {
    console.log(`\n[7] Patchright+ISP: ${product.label}`);
    const t0 = Date.now();
    try {
      const result = await tryPatchrightWithIspProxy(product.url);
      const elapsed = Date.now() - t0;

      if (!result.ok) {
        console.log(`     → ❌ ${result.error}`);
        continue;
      }

      const icon = result.blocked ? '⚠️  BLOCKED' : result.priceData ? '✅ SUCCESS' : '⚠️  NO PRICE';
      console.log(`     → ${icon}`);
      console.log(`        HTTP status : ${result.status}`);
      console.log(`        final URL   : ${result.finalUrl}`);
      console.log(`        title       : ${result.title}`);
      console.log(`        bodyLen     : ${result.bodyLen}`);
      console.log(`        blocked     : ${result.blocked}`);
      console.log(`        elapsed ms  : ${result.ms} (total incl. launch: ${elapsed}ms)`);
      if (result.priceData) {
        console.log(`        price       : ${result.priceData.price}`);
        console.log(`        regularPrice: ${result.priceData.regularPrice ?? '(not found)'}`);
        console.log(`        availability: ${result.priceData.availability ?? '(not found)'}`);
        console.log(`        imageUrl    : ${result.priceData.imageUrl?.slice(0, 60) ?? '(not found)'}`);
        console.log(`        sku/id      : ${result.priceData.sku ?? '(not found)'}`);
        console.log(`        source      : ${result.priceData.source}`);
      } else {
        console.log(`        price       : (not extracted)`);
      }
    } catch (err) {
      console.log(`     → ❌ ERROR: ${err.message.split('\n')[0]}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  PROBE COMPLETE');
  console.log('─'.repeat(60));
  console.log('  Decision guide:');
  console.log('  [7] ✅ price found    → Patchright+ISP works — this is the fix');
  console.log('  [7] ⚠️  no price      → page loads but extraction needs adjustment');
  console.log('  [7] ⚠️  BLOCKED       → ISP proxy still blocked by BB');
  console.log('  [7] ❌ credentials    → ISP_PROXY_* env vars not set on worker');
  console.log('  [7] ❌ timeout/hang   → proxy connectivity issue');
  console.log('  [6] ❌ + [7] ✅       → ISP proxy is the key, not patchright alone');
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

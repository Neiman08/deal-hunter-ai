/**
 * Browser Engine — Playwright shared pool with proxy support
 *
 * Provides a single managed Chromium instance shared across all scrapers.
 * Handles: stealth mode, proxy rotation, fingerprint randomization,
 * rate limiting, context isolation, and graceful shutdown.
 *
 * ─────────────────────────────────────────────────────────────────
 * PROXY SETUP (optional but strongly recommended for production)
 * ─────────────────────────────────────────────────────────────────
 *
 * SmartProxy Residential:
 *   PROXY_ENABLED=true
 *   PROXY_PROVIDER=smartproxy
 *   PROXY_HOST=gate.smartproxy.com
 *   PROXY_PORT=10000
 *   PROXY_USER=your_username
 *   PROXY_PASS=your_password
 *
 * Bright Data Residential:
 *   PROXY_ENABLED=true
 *   PROXY_PROVIDER=brightdata
 *   PROXY_HOST=brd.superproxy.io
 *   PROXY_PORT=22225
 *   PROXY_USER=brd-customer-XXXX-zone-residential
 *   PROXY_PASS=your_password
 *
 * Oxylabs:
 *   PROXY_ENABLED=true
 *   PROXY_PROVIDER=oxylabs
 *   PROXY_HOST=pr.oxylabs.io
 *   PROXY_PORT=7777
 *   PROXY_USER=your_username
 *   PROXY_PASS=your_password
 *
 * Generic HTTP proxy:
 *   PROXY_ENABLED=true
 *   PROXY_URL=http://user:pass@host:port
 *
 * ─────────────────────────────────────────────────────────────────
 */

// Point Playwright to browsers stored in the project directory (survives Render deploys)
const path = require('path');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '../../pw-browsers');
}

const { chromium } = require('playwright');
const logger = require('../utils/logger');

// Patchright — patched Chromium fork that bypasses TLS/HTTP2 bot-detection fingerprints.
// Used exclusively for Best Buy, which detects standard Playwright via HTTP2 RST_STREAM.
// Graceful fallback to standard chromium if patchright browsers aren't installed yet.
let _patchrightChromium = null;
try {
  _patchrightChromium = require('patchright').chromium;
} catch {
  // patchright not available — BB contexts will fall back to standard chromium
}

// ─── Realistic browser fingerprints ──────────────────────────────────────────
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

const LOCALES = ['en-US', 'en-US', 'en-US', 'en-GB', 'en-CA'];
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Denver', 'America/Chicago'];

let uaIndex = 0;
const randomize = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nextUA = () => USER_AGENTS[uaIndex++ % USER_AGENTS.length];

// ─── Browser instance (singleton) ────────────────────────────────────────────
let browserInstance = null;
let launchPromise   = null;

function buildProxyConfig() {
  if (!process.env.PROXY_ENABLED || process.env.PROXY_ENABLED !== 'true') return null;

  // Direct URL takes priority
  if (process.env.PROXY_URL) {
    logger.info('[Browser] Proxy: using PROXY_URL');
    return { server: process.env.PROXY_URL };
  }

  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port) {
    logger.warn('[Browser] PROXY_ENABLED=true but PROXY_HOST/PROXY_PORT missing');
    return null;
  }

  const server = `http://${host}:${port}`;
  logger.info(`[Browser] Proxy: ${process.env.PROXY_PROVIDER || 'generic'} @ ${host}:${port}`);

  return { server, username: user, password: pass };
}

function buildIspProxyConfig() {
  if (process.env.ISP_PROXY_ENABLED !== 'true') return null;
  const host = process.env.ISP_PROXY_HOST;
  const port = process.env.ISP_PROXY_PORT || '33335';
  const user = process.env.ISP_PROXY_USER;
  const pass = process.env.ISP_PROXY_PASS;
  if (!host || !user || !pass) {
    logger.warn('[Browser:ISP] ISP proxy env vars missing — ISP context unavailable');
    return null;
  }
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

// BB always routes through ISP proxy — independent of ISP_PROXY_ENABLED flag.
// ISP proxies provide static US residential IPs that BB's Akamai CDN cannot block.
function buildBbIspProxyConfig() {
  const host = process.env.ISP_PROXY_HOST;
  const port = process.env.ISP_PROXY_PORT || '33335';
  const user = process.env.ISP_PROXY_USER;
  const pass = process.env.ISP_PROXY_PASS;
  if (!host || !user || !pass) {
    logger.warn('[Browser:BB] ISP_PROXY credentials missing — BB will run without proxy (may fail)');
    return null;
  }
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    logger.info('[Browser] Launching Chromium...');

    const proxyConfig = buildProxyConfig();

    const launchOptions = {
      headless: true,
      args: [
        '--disable-http2',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--no-first-run',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--allow-running-insecure-content',
      ],
    };

    // --disable-http2 in args only works for direct connections.
    // When a proxy is active, the proxy establishes its own HTTP/2 session
    // with the remote server — the flag has no effect on that connection.
    // Best Buy uses HTTP/2 server push, which breaks when resources are
    // aborted mid-stream. Best Buy gets its own no-proxy browser instance.
    if (proxyConfig) launchOptions.proxy = proxyConfig;

    browserInstance = await chromium.launch(launchOptions);

    browserInstance.on('disconnected', () => {
      logger.warn('[Browser] Chromium disconnected — will relaunch on next request');
      browserInstance = null;
      launchPromise   = null;
    });

    logger.info('[Browser] Chromium ready');
    return browserInstance;
  })();

  return launchPromise;
}

/**
 * Creates an isolated browser context with randomized fingerprint.
 * Each scraper call gets its own context → prevents cookie/session leakage.
 */
async function newContext(options = {}) {
  const browser   = await getBrowser();
  const ua        = nextUA();
  const viewport  = randomize(VIEWPORTS);
  const locale    = randomize(LOCALES);
  const timezone  = randomize(TIMEZONES);

  const ctxOptions = {
    ignoreHTTPSErrors: true,
    userAgent:         ua,
    viewport,
    locale,
    timezoneId:        timezone,
    javaScriptEnabled: true,
    acceptDownloads:   false,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest':  'document',
      'Sec-Fetch-Mode':  'navigate',
      'Sec-Fetch-Site':  'none',
      'Sec-Fetch-User':  '?1',
    },
    ...options,
  };

  // Override proxy per-context if needed (e.g., rotating proxies)
  const ctx = await browser.newContext(ctxOptions);

  // ─── Stealth patches ──────────────────────────────────────────────────────
  await ctx.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Realistic plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{
        name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
      }],
    });

    // Realistic languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Pass Chrome checks
    window.chrome = { runtime: {} };

    // Permissions
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }
  });

  return ctx;
}

/**
 * Opens a page with the given URL, waits for network idle, returns page.
 * Caller is responsible for closing the context after use.
 */
async function openPage(url, waitUntil = 'domcontentloaded') {
  const ctx  = await newContext();
  const page = await ctx.newPage();

  // NOTE: Resource blocking (abort images/fonts) removed from here.
  // Aborting resources mid-stream breaks HTTP/2 connections on sites
  // like Best Buy that use server push (ERR_HTTP2_PROTOCOL_ERROR).
  // If a specific scraper needs resource blocking, do it in newContext()
  // before the page.goto() call, not here globally.

  try {
    await page.goto(url, {
      waitUntil,
      timeout: parseInt(process.env.PAGE_TIMEOUT_MS) || 30000,
    });
    return { page, ctx };
  } catch (err) {
    await ctx.close();
    throw err;
  }
}

/**
 * Execute a scraping function with automatic context cleanup.
 * Usage:
 *   const data = await withPage('https://...', async (page) => {
 *     return await page.$eval(...);
 *   });
 */
async function withPage(url, fn, options = {}) {
  const waitUntil = options.waitUntil || 'domcontentloaded';
  let ctx, page;

  try {
    ({ ctx, page } = await openPage(url, waitUntil));
    const result = await fn(page);
    return result;
  } finally {
    if (page)  await page.close().catch(() => {});
    if (ctx)   await ctx.close().catch(() => {});
  }
}

/** Graceful shutdown */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    launchPromise   = null;
    logger.info('[Browser] Chromium closed');
  }
}

/**
 * Restart all browser pools — call every N discovery cycles to reclaim memory.
 * New requests after this will trigger a fresh launch automatically.
 */
async function restartBrowserPool() {
  logger.info('[Browser] Restarting all browser pools (memory reclaim)...');
  const closes = [];
  if (browserInstance)      closes.push(browserInstance.close().catch(() => {}));
  if (bbBrowserInstance)    closes.push(bbBrowserInstance.close().catch(() => {}));
  if (macysBrowserInstance) closes.push(macysBrowserInstance.close().catch(() => {}));
  if (ispBrowserInstance)   closes.push(ispBrowserInstance.close().catch(() => {}));
  await Promise.all(closes);
  browserInstance      = null; launchPromise      = null;
  bbBrowserInstance    = null; bbLaunchPromise    = null;
  macysBrowserInstance = null; macysLaunchPromise = null;
  ispBrowserInstance   = null; ispLaunchPromise   = null;
  logger.info('[Browser] All pools cleared — will relaunch on next request');
}

// Shutdown on process exit
process.on('SIGINT',  () => closeBrowser());
process.on('SIGTERM', () => closeBrowser());

module.exports = { getBrowser, newContext, openPage, withPage, closeBrowser, restartBrowserPool, newBestBuyContext, newBestBuyDiscoveryContext, newMacysContext, newIspContext };

// ─────────────────────────────────────────────────────────────────────────────
// Best Buy specific context — ISP proxy + Patchright
//
// BB's Akamai CDN blocks datacenter IPs via TLS/HTTP2 fingerprint (ERR_HTTP2_PROTOCOL_ERROR).
// Fix: route all BB traffic (product scan + discovery) through BrightData ISP proxy,
// which provides static US residential-ISP IPs that Akamai cannot distinguish from
// real users. Patchright patches the browser binary to remove automation fingerprints.
// ─────────────────────────────────────────────────────────────────────────────
let bbBrowserInstance = null;
let bbLaunchPromise   = null;

// Separate browser instance for discovery — prevents discovery from sharing context
// with the product scanner and crashing the scanner when discovery closes pages.
let bbDiscoveryBrowserInstance = null;
let bbDiscoveryLaunchPromise   = null;

function _bbLaunchArgs(withProxy = false) {
  const isLinux = process.platform === 'linux';
  const args = [
    ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    // --ignore-certificate-errors required: BrightData ISP proxy presents a
    // self-signed cert in the CONNECT tunnel that Chromium rejects without this.
    ...(withProxy ? ['--ignore-certificate-errors'] : []),
  ];
  return {
    headless: isLinux ? true : process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args,
  };
}

async function getBestBuyBrowser() {
  if (bbBrowserInstance && bbBrowserInstance.isConnected()) return bbBrowserInstance;
  if (bbLaunchPromise) return bbLaunchPromise;

  bbLaunchPromise = (async () => {
    const proxyConfig = buildBbIspProxyConfig();
    const { headless, args } = _bbLaunchArgs(!!proxyConfig);
    const launcher = _patchrightChromium || chromium;
    const engine   = _patchrightChromium ? 'patchright' : 'playwright';
    const host     = process.env.ISP_PROXY_HOST || '(none)';
    const port     = process.env.ISP_PROXY_PORT || '33335';
    logger.info(`[Browser:BB] Launching | engine=${engine} | proxy=ISP | host=${host} | port=${port}`);
    const launchOpts = { headless, args };
    if (proxyConfig) launchOpts.proxy = proxyConfig;
    bbBrowserInstance = await launcher.launch(launchOpts);
    bbBrowserInstance.on('disconnected', () => {
      logger.warn('[Browser:BB] Disconnected — will relaunch on next request');
      bbBrowserInstance = null;
      bbLaunchPromise   = null;
    });
    logger.info(`[Browser:BB] Ready | engine=${engine} | proxy=${proxyConfig ? 'ISP' : 'none'}`);
    return bbBrowserInstance;
  })();

  return bbLaunchPromise;
}

async function getBestBuyDiscoveryBrowser() {
  if (bbDiscoveryBrowserInstance && bbDiscoveryBrowserInstance.isConnected()) return bbDiscoveryBrowserInstance;
  if (bbDiscoveryLaunchPromise) return bbDiscoveryLaunchPromise;

  bbDiscoveryLaunchPromise = (async () => {
    const proxyConfig = buildBbIspProxyConfig();
    const { headless, args } = _bbLaunchArgs(!!proxyConfig);
    const launcher = _patchrightChromium || chromium;
    const engine   = _patchrightChromium ? 'patchright' : 'playwright';
    const host     = process.env.ISP_PROXY_HOST || '(none)';
    const port     = process.env.ISP_PROXY_PORT || '33335';
    logger.info(`[Browser:BB-Discovery] Launching | engine=${engine} | proxy=ISP | host=${host} | port=${port}`);
    const launchOpts = { headless, args };
    if (proxyConfig) launchOpts.proxy = proxyConfig;
    bbDiscoveryBrowserInstance = await launcher.launch(launchOpts);
    bbDiscoveryBrowserInstance.on('disconnected', () => {
      logger.warn('[Browser:BB-Discovery] Disconnected — will relaunch on next request');
      bbDiscoveryBrowserInstance = null;
      bbDiscoveryLaunchPromise   = null;
    });
    logger.info(`[Browser:BB-Discovery] Ready | engine=${engine} | proxy=${proxyConfig ? 'ISP' : 'none'}`);
    return bbDiscoveryBrowserInstance;
  })();

  return bbDiscoveryLaunchPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Macy's specific context — uses proxy when available (Akamai blocks datacenter
// IPs via TLS fingerprint). Falls back to enhanced stealth without proxy.
//
// Key differences from newContext():
//   1. Cache-Control header — prevents Akamai from flagging as bot on first hit
//   2. Extra plugins in navigator — closer to a real Chrome profile
//   3. Erases all headless/automation artifacts more aggressively
//   4. Routes through proxy when PROXY_ENABLED=true (required for reliability)
// ─────────────────────────────────────────────────────────────────────────────
let macysBrowserInstance = null;
let macysLaunchPromise   = null;

async function getMacysBrowser() {
  if (macysBrowserInstance && macysBrowserInstance.isConnected()) return macysBrowserInstance;
  if (macysLaunchPromise) return macysLaunchPromise;

  macysLaunchPromise = (async () => {
    const isLinux    = process.platform === 'linux';
    const proxyConfig = buildProxyConfig();
    // Non-headless passes far more Akamai JS checks (no headless Chrome fingerprints).
    // Respect PLAYWRIGHT_HEADLESS=false in env when available (defaults to headless on Linux/CI).
    const headless = isLinux ? true : process.env.PLAYWRIGHT_HEADLESS !== 'false';

    // Minimal args — Akamai fingerprints the Chrome args list via JS.
    // --ignore-certificate-errors required: BrightData CONNECT tunnel presents
    // a self-signed cert which Chromium rejects without this flag.
    const args = [
      '--disable-blink-features=AutomationControlled',
      ...(proxyConfig ? ['--ignore-certificate-errors'] : []),
      ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ];

    const launchOpts = { headless, args };
    if (proxyConfig) launchOpts.proxy = proxyConfig;
    // Use real Google Chrome on macOS/Windows — gives authentic JA3 TLS fingerprint
    // that Akamai expects. Chromium's JA3 is different and gets flagged.
    // On Linux/CI we fall back to Chromium (Chrome channel not reliably available).
    if (!isLinux) launchOpts.channel = 'chrome';

    logger.info(`[Browser:Macys] Launching | proxy=${!!proxyConfig} | headless=${headless} | channel=${launchOpts.channel || 'chromium'} | args=[${args.join(', ')}]`);
    macysBrowserInstance = await chromium.launch(launchOpts);
    macysBrowserInstance.on('disconnected', () => {
      logger.warn('[Browser:Macys] Macy\'s browser disconnected');
      macysBrowserInstance = null;
      macysLaunchPromise   = null;
    });
    logger.info('[Browser:Macys] Ready');
    return macysBrowserInstance;
  })();

  return macysLaunchPromise;
}

async function newMacysContext(options = {}) {
  const browser  = await getMacysBrowser();
  const ua       = nextUA();
  const viewport = randomize(VIEWPORTS);

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:  ua,
    viewport,
    locale:     'en-US',
    timezoneId: randomize(TIMEZONES),
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'Accept-Language':       'en-US,en;q=0.9',
      'Accept-Encoding':       'gzip, deflate, br',
      'Accept':                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control':         'max-age=0',
      'Sec-Fetch-Dest':        'document',
      'Sec-Fetch-Mode':        'navigate',
      'Sec-Fetch-Site':        'none',
      'Sec-Fetch-User':        '?1',
    },
    ...options,
  });

  // Enhanced stealth — erases all Akamai-visible automation signals
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Multi-plugin profile (single plugin is a bot signal)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin',   filename: 'internal-pdf-viewer',           description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',   filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client',       filename: 'internal-nacl-plugin',           description: '' },
      ],
    });

    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'language',  { get: () => 'en-US' });

    // Full chrome object — Akamai checks for chrome.app and chrome.loadTimes
    window.chrome = {
      runtime:    {},
      loadTimes:  function() { return {}; },
      csi:        function() { return {}; },
      app:        { isInstalled: false, InstallState: {}, RunningState: {} },
    };

    // Remove all headless artifacts
    ['__nightmare', '_selenium', 'callSelenium', '_Selenium_IDE_Recorder',
     'domAutomation', 'domAutomationController', '__webdriver_script_fn',
     '__driver_evaluate', '__webdriver_evaluate'].forEach(k => {
      try { delete window[k]; } catch {}
    });

    // Permissions — Akamai probes this API
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (p) =>
        p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(p);
    }
  });

  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// ISP proxy context — bypasses Akamai EdgeSuite blocks
//
// Uses BrightData ISP proxy (port 33335): static IPs from real ISPs.
// Akamai cannot distinguish ISP IPs from real users.
// Use for: Kohl's, TJ Maxx, Marshalls, Burlington, Nordstrom Rack, Macy's, Lowe's.
// ─────────────────────────────────────────────────────────────────────────────
let ispBrowserInstance = null;
let ispLaunchPromise   = null;

async function getIspBrowser() {
  if (ispBrowserInstance && ispBrowserInstance.isConnected()) return ispBrowserInstance;
  if (ispLaunchPromise) return ispLaunchPromise;

  ispLaunchPromise = (async () => {
    const isLinux     = process.platform === 'linux';
    const proxyConfig = buildIspProxyConfig();
    const headless    = isLinux ? true : process.env.PLAYWRIGHT_HEADLESS !== 'false';

    const args = [
      '--disable-blink-features=AutomationControlled',
      ...(proxyConfig ? ['--ignore-certificate-errors'] : []),
      ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ];

    const launchOpts = { headless, args };
    if (proxyConfig) launchOpts.proxy = proxyConfig;
    // Real Chrome for authentic JA3 TLS fingerprint (Akamai key check)
    if (!isLinux) launchOpts.channel = 'chrome';

    logger.info(`[Browser:ISP] Launching | proxy=${!!proxyConfig} | host=${process.env.ISP_PROXY_HOST}:${process.env.ISP_PROXY_PORT} | headless=${headless}`);
    ispBrowserInstance = await chromium.launch(launchOpts);
    ispBrowserInstance.on('disconnected', () => {
      logger.warn('[Browser:ISP] ISP browser disconnected');
      ispBrowserInstance = null;
      ispLaunchPromise   = null;
    });
    logger.info('[Browser:ISP] Ready');
    return ispBrowserInstance;
  })();

  return ispLaunchPromise;
}

async function newIspContext(options = {}) {
  const browser  = await getIspBrowser();
  const ua       = nextUA();
  const viewport = randomize(VIEWPORTS);

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:  ua,
    viewport,
    locale:     'en-US',
    timezoneId: randomize(TIMEZONES),
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'Accept-Language':           'en-US,en;q=0.9',
      'Accept-Encoding':           'gzip, deflate, br',
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control':             'max-age=0',
      'Sec-Fetch-Dest':            'document',
      'Sec-Fetch-Mode':            'navigate',
      'Sec-Fetch-Site':            'none',
      'Sec-Fetch-User':            '?1',
    },
    ...options,
  });

  // Same enhanced stealth as Macy's context — removes all Akamai-visible automation signals
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
    Object.defineProperty(navigator, 'language',  { get: () => 'en-US' });
    window.chrome = {
      runtime:    {},
      loadTimes:  function() { return {}; },
      csi:        function() { return {}; },
      app:        { isInstalled: false, InstallState: {}, RunningState: {} },
    };
    ['__nightmare', '_selenium', 'callSelenium', '_Selenium_IDE_Recorder',
     'domAutomation', 'domAutomationController', '__webdriver_script_fn',
     '__driver_evaluate', '__webdriver_evaluate'].forEach(k => {
      try { delete window[k]; } catch {}
    });
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (p) =>
        p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(p);
    }
  });

  return ctx;
}

const BB_CONTEXT_OPTS = (options = {}) => ({
  ignoreHTTPSErrors: true,
  userAgent:  nextUA(),
  viewport:   randomize(VIEWPORTS),
  locale:     'en-US',
  timezoneId: randomize(TIMEZONES),
  javaScriptEnabled: true,
  permissions: [],
  geolocation: undefined,
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest':  'document',
    'Sec-Fetch-Mode':  'navigate',
    'Sec-Fetch-Site':  'none',
    'Sec-Fetch-User':  '?1',
  },
  ...options,
});

async function _addBBStealth(ctx) {
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }],
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'language',  { get: () => 'en-US' });
    window.chrome = { runtime: {} };
  });
}

const RECONNECT_ERRORS = ['Browser disconnected', 'Target closed', 'Context closed', 'Page closed'];

async function newBestBuyContext(options = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const browser = await getBestBuyBrowser();
      const ctx = await browser.newContext(BB_CONTEXT_OPTS(options));
      await _addBBStealth(ctx);
      return ctx;
    } catch (err) {
      if (i < 2 && RECONNECT_ERRORS.some(e => err.message.includes(e))) {
        logger.warn(`[Browser:BB] Context creation failed (${err.message}) — re-launching browser`);
        bbBrowserInstance = null;
        bbLaunchPromise   = null;
        continue;
      }
      throw err;
    }
  }
}

// Dedicated context factory for Best Buy Discovery — uses a separate browser instance
// so discovery pages cannot crash or interfere with the product scanner browser.
async function newBestBuyDiscoveryContext(options = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const browser = await getBestBuyDiscoveryBrowser();
      const ctx = await browser.newContext(BB_CONTEXT_OPTS(options));
      await _addBBStealth(ctx);
      return ctx;
    } catch (err) {
      if (i < 2 && RECONNECT_ERRORS.some(e => err.message.includes(e))) {
        logger.warn(`[Browser:BB-Discovery] Context creation failed (${err.message}) — re-launching browser`);
        bbDiscoveryBrowserInstance = null;
        bbDiscoveryLaunchPromise   = null;
        continue;
      }
      throw err;
    }
  }
}

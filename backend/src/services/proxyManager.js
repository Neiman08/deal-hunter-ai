/**
 * Proxy Manager — Centralized proxy strategy per store
 *
 * Strategies:
 *   direct      — no proxy (Best Buy, Target, Home Depot, GameStop, etc.)
 *   residential — BrightData residential proxy (port 22225)
 *   isp         — BrightData ISP proxy (port 33335) — bypasses Akamai
 *
 * ISP proxies are static IPs from real ISPs — Akamai cannot distinguish them
 * from real users. Use for: Kohl's, TJ Maxx, Marshalls, Burlington, Macy's,
 * Nordstrom Rack, Lowe's.
 *
 * Tracks failures per store to avoid wasting proxy bandwidth.
 */

const logger = require('../utils/logger');

// ── Per-store proxy strategy ──────────────────────────────────────────────────
const STORE_PROXY_STRATEGY = {
  'best-buy':      'direct',
  'target':        'direct',
  'walmart':       'direct',
  'home-depot':    'direct',
  'gamestop':      'direct',
  'office-depot':  'direct',
  'staples':       'direct',
  'sams-club':     'direct',
  'costco':        'direct',
  'walgreens':     'direct',
  'cvs':           'direct',
  // ISP proxy (Akamai bypass) — previously "residential" wasn't enough
  'lowes':         'isp',
  'nordstrom-rack':'isp',
  'macys':         'isp',
  'kohls':         'isp',
  'tj-maxx':       'isp',
  'marshalls':     'isp',
  'burlington':    'isp',
};

// ── BrightData residential proxy (port 22225) ─────────────────────────────────
function buildResidentialConfig(sessionId = null) {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT || '22225';
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !user || !pass) {
    logger.warn('[ProxyManager] Residential proxy env vars missing');
    return null;
  }

  const username = sessionId ? `${user}-session-${sessionId}` : user;
  return { server: `http://${host}:${port}`, username, password: pass };
}

// ── BrightData ISP proxy (port 33335) — bypasses Akamai ──────────────────────
function buildIspConfig(sessionId = null) {
  const host = process.env.ISP_PROXY_HOST || process.env.PROXY_HOST;
  const port = process.env.ISP_PROXY_PORT || '33335';
  const user = process.env.ISP_PROXY_USER;
  const pass = process.env.ISP_PROXY_PASS;

  if (!host || !user || !pass) {
    logger.warn('[ProxyManager] ISP proxy env vars missing — falling back to residential');
    return buildResidentialConfig(sessionId);
  }

  const username = sessionId ? `${user}-session-${sessionId}` : user;
  return { server: `http://${host}:${port}`, username, password: pass };
}

// ── Failure tracking ──────────────────────────────────────────────────────────
const failureLog = {}; // { storeSlug: [{ ts, errorCode, type }] }
const MAX_FAILURES_BEFORE_SKIP = 2;

function getRecentFailures(storeSlug) {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1-hour window
  return (failureLog[storeSlug] || []).filter(f => f.ts > cutoff);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns Playwright proxy config for a store, or null for direct connection.
 */
function getProxyForStore(storeSlug) {
  const proxyEnabled = process.env.PROXY_ENABLED === 'true';
  const ispEnabled   = process.env.ISP_PROXY_ENABLED === 'true';

  if (!proxyEnabled && !ispEnabled) return null;

  const strategy = STORE_PROXY_STRATEGY[storeSlug] || 'direct';

  if (strategy === 'isp' && ispEnabled)         return buildIspConfig();
  if (strategy === 'residential' && proxyEnabled) return buildResidentialConfig();
  if (strategy === 'isp' && proxyEnabled)         return buildResidentialConfig(); // ISP fallback

  return null;
}

/**
 * Returns full Playwright browser launch options for a given store.
 */
function getBrowserOptionsForStore(storeSlug) {
  const proxy = getProxyForStore(storeSlug);
  const isLinux = process.platform === 'linux';

  const args = [
    '--disable-blink-features=AutomationControlled',
    ...(proxy ? ['--ignore-certificate-errors'] : []),
    ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  ];

  const opts = {
    headless: isLinux ? true : process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args,
  };
  if (proxy) opts.proxy = proxy;
  return opts;
}

/**
 * Returns true if this store uses any proxy (residential or ISP).
 */
function shouldUseProxy(storeSlug) {
  const strategy = STORE_PROXY_STRATEGY[storeSlug] || 'direct';
  if (strategy === 'direct') return false;
  if (strategy === 'residential') return process.env.PROXY_ENABLED === 'true';
  if (strategy === 'isp')         return process.env.ISP_PROXY_ENABLED === 'true' || process.env.PROXY_ENABLED === 'true';
  return false;
}

/**
 * Returns a session-pinned proxy config (IP rotation).
 */
function rotateProxySession(storeSlug) {
  if (!shouldUseProxy(storeSlug)) return null;
  const sessionId = `${storeSlug}-${Date.now()}`;
  const strategy = STORE_PROXY_STRATEGY[storeSlug] || 'direct';
  logger.info(`[ProxyManager] Rotating session for ${storeSlug}: ${sessionId} (${strategy})`);
  return strategy === 'isp' ? buildIspConfig(sessionId) : buildResidentialConfig(sessionId);
}

/**
 * Log a proxy failure. Returns true if store should be skipped.
 */
function logProxyFailure(storeSlug, errorCode, type = 'unknown') {
  if (!failureLog[storeSlug]) failureLog[storeSlug] = [];

  failureLog[storeSlug].push({ ts: Date.now(), errorCode, type });

  const recent = getRecentFailures(storeSlug);
  const blockCount = recent.filter(f => ['akamai', 'blocked', 'captcha'].includes(f.type)).length;

  logger.warn(`[ProxyManager] ${storeSlug} failure: ${type} (${errorCode}) | recent blocks: ${blockCount}`);

  if (blockCount >= MAX_FAILURES_BEFORE_SKIP) {
    logger.warn(`[ProxyManager] ${storeSlug} — skipping for this cycle (too many blocks)`);
    return true;
  }
  return false;
}

/**
 * Returns true if the store should be skipped due to recent failures.
 */
function shouldSkipStore(storeSlug) {
  const recent = getRecentFailures(storeSlug);
  const blockCount = recent.filter(f => ['akamai', 'blocked', 'captcha'].includes(f.type)).length;
  return blockCount >= MAX_FAILURES_BEFORE_SKIP;
}

/**
 * Clear failure history for a store (called after a successful request).
 */
function clearFailures(storeSlug) {
  failureLog[storeSlug] = [];
}

/**
 * Returns failure summary for all stores (debugging).
 */
function getFailureSummary() {
  const summary = {};
  for (const [slug, entries] of Object.entries(failureLog)) {
    const recent = getRecentFailures(slug);
    if (recent.length > 0) summary[slug] = recent;
  }
  return summary;
}

module.exports = {
  getProxyForStore,
  getBrowserOptionsForStore,
  shouldUseProxy,
  rotateProxySession,
  logProxyFailure,
  shouldSkipStore,
  clearFailures,
  getFailureSummary,
  STORE_PROXY_STRATEGY,
};

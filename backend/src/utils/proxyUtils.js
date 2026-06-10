/**
 * proxyUtils — shared HTTP proxy agent factory for Node.js https.get calls.
 *
 * Uses PROXY_PORT exactly as configured in env vars — no auto-correction.
 * BrightData zone/port assignment is managed in Render env vars, not here.
 */

const logger = require('./logger');

function buildHttpProxyAgent(storeLabel = '') {
  if (process.env.PROXY_ENABLED !== 'true') return null;

  const host = process.env.PROXY_HOST;
  const user = process.env.PROXY_USER || '';
  const pass = process.env.PROXY_PASS || '';

  if (!user || !pass || !host) {
    logger.warn(`[ProxyUtils:${storeLabel}] PROXY_ENABLED=true but credentials missing`);
    return null;
  }

  const port = parseInt(process.env.PROXY_PORT) || 22225;

  const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
  logger.info(`[ProxyUtils:${storeLabel}] Agent → ${host}:${port} (zone=${user.split('-zone-')[1]?.split('-country')[0] || 'unknown'})`);

  try {
    const HttpsProxyAgent = require('https-proxy-agent');
    const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
    return new Ctor(proxyUrl, { rejectUnauthorized: false });
  } catch (e) {
    logger.error(`[ProxyUtils:${storeLabel}] Agent init failed: ${e.message}`);
    return null;
  }
}

function buildIspHttpProxyAgent(storeLabel = '') {
  const host = process.env.ISP_PROXY_HOST || process.env.PROXY_HOST;
  const user = process.env.ISP_PROXY_USER || '';
  const pass = process.env.ISP_PROXY_PASS || '';
  const port = parseInt(process.env.ISP_PROXY_PORT) || 33335;

  if (!user || !pass || !host) {
    logger.warn(`[ProxyUtils:${storeLabel}] ISP_PROXY credentials missing`);
    return null;
  }

  const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
  logger.info(`[ProxyUtils:${storeLabel}] ISP Agent → ${host}:${port} (zone=${user.split('-zone-')[1]?.split('-country')[0] || 'unknown'})`);

  try {
    const HttpsProxyAgent = require('https-proxy-agent');
    const Ctor = typeof HttpsProxyAgent === 'function' ? HttpsProxyAgent : HttpsProxyAgent.HttpsProxyAgent;
    return new Ctor(proxyUrl, { rejectUnauthorized: false });
  } catch (e) {
    logger.error(`[ProxyUtils:${storeLabel}] ISP Agent init failed: ${e.message}`);
    return null;
  }
}

module.exports = { buildHttpProxyAgent, buildIspHttpProxyAgent };

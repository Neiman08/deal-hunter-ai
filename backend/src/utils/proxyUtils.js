/**
 * proxyUtils — shared HTTP proxy agent factory for Node.js https.get calls.
 *
 * Auto-corrects common misconfigurations:
 *   residential zone user → forces port 22225
 *   ISP zone user         → forces port 33335
 * This prevents HTTP 407 when PROXY_PORT env var is set to the wrong zone.
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

  const envPort = parseInt(process.env.PROXY_PORT) || 22225;

  // Auto-correct zone/port mismatch — BrightData zones are strict:
  //   zone-residential_proxy* → port 22225
  //   zone-isp_proxy*         → port 33335
  let port = envPort;
  if (user.includes('residential') && envPort === 33335) {
    logger.warn(`[ProxyUtils:${storeLabel}] ⚠️  Mismatch: residential zone on port 33335 → auto-correcting to 22225`);
    port = 22225;
  } else if (user.includes('isp_proxy') && envPort === 22225) {
    logger.warn(`[ProxyUtils:${storeLabel}] ⚠️  Mismatch: ISP zone on port 22225 → auto-correcting to 33335`);
    port = 33335;
  }

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

module.exports = { buildHttpProxyAgent };

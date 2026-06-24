/**
 * Proxy health check — detects 407 (billing/auth failure) before opening browser.
 *
 * HTTP 407 Proxy Authentication Required means:
 *  - BrightData balance exhausted, OR
 *  - ISP proxy credentials rejected, OR
 *  - Account suspended
 *
 * Call checkIspProxy407() before any withIspPage() call.
 * If it returns { ok: false }, abort discovery and return blocked=true.
 * This prevents burning retries and browser time against a dead proxy.
 */

const net    = require('net');
const logger = require('../utils/logger');

const CHECK_TIMEOUT_MS = 8000;
const CONNECT_TARGET   = 'www.example.com:443';

/**
 * Sends a CONNECT tunnel request to the ISP proxy.
 * Returns { ok: true } if 200, { ok: false, reason } if 407 or error.
 * Does NOT open a browser — pure TCP socket, zero proxy cost.
 */
function checkIspProxy407() {
  return new Promise((resolve) => {
    const host = process.env.ISP_PROXY_HOST || process.env.PROXY_HOST;
    const port = parseInt(process.env.ISP_PROXY_PORT || '33335', 10);
    const user = process.env.ISP_PROXY_USER;
    const pass = process.env.ISP_PROXY_PASS;

    if (!host || !user || !pass) {
      logger.warn('[ProxyCheck] ISP proxy env vars missing — treating as unavailable');
      return resolve({ ok: false, reason: 'isp_env_missing' });
    }

    if (process.env.PROXY_KILL_SWITCH === 'true') {
      return resolve({ ok: false, reason: 'proxy_kill_switch' });
    }

    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    let responded = false;

    const socket = net.connect(port, host, () => {
      socket.write(
        `CONNECT ${CONNECT_TARGET} HTTP/1.1\r\n` +
        `Host: ${CONNECT_TARGET}\r\n` +
        `Proxy-Authorization: Basic ${auth}\r\n\r\n`
      );
    });

    socket.setTimeout(CHECK_TIMEOUT_MS);

    let data = '';
    socket.on('data', (chunk) => {
      if (responded) return;
      data += chunk.toString();
      const eoh = data.indexOf('\r\n\r\n');
      if (eoh === -1) return;

      responded = true;
      socket.destroy();

      const statusLine = data.split('\r\n')[0] || data.split('\n')[0] || '';
      logger.debug(`[ProxyCheck] ISP CONNECT response: ${statusLine.trim()}`);

      if (statusLine.includes(' 200')) {
        resolve({ ok: true });
      } else if (statusLine.includes(' 407')) {
        logger.warn('[ProxyCheck] ISP proxy returned 407 — billing exhausted or auth failed');
        resolve({ ok: false, reason: 'proxy_407_billing' });
      } else {
        resolve({ ok: false, reason: statusLine.trim() || 'unknown_response' });
      }
    });

    socket.on('timeout', () => {
      if (responded) return;
      responded = true;
      socket.destroy();
      logger.warn('[ProxyCheck] ISP proxy CONNECT timed out');
      resolve({ ok: false, reason: 'proxy_connect_timeout' });
    });

    socket.on('error', (err) => {
      if (responded) return;
      responded = true;
      logger.warn(`[ProxyCheck] ISP proxy socket error: ${err.message}`);
      resolve({ ok: false, reason: err.message });
    });
  });
}

module.exports = { checkIspProxy407 };

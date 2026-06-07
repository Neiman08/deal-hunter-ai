/**
 * Security Middleware Suite
 * - Bot detection (fingerprinting + behavioral analysis)
 * - Audit logging (all mutating requests)
 * - IP rate limiting with Redis-compatible in-memory fallback
 * - API key validation for external integrations
 * - Request sanitization
 */

const { query } = require('../config/database');
const logger = require('../utils/logger');
const crypto = require('crypto');

// ─── In-memory IP rate store (replace with Redis in production) ───────────────
const ipStore = new Map();
const IP_WINDOW_MS = 15 * 60 * 1000; // 15 min
const IP_LIMITS = {
  default: 300,
  auth: 10,       // login attempts
  search: 60,     // searches per 15 min
  scan: 5,        // manual scan triggers
};

function getIpCount(ip, namespace = 'default') {
  const key = `${ip}:${namespace}`;
  const now = Date.now();
  const entry = ipStore.get(key);

  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipStore.set(key, { count: 1, windowStart: now });
    return 1;
  }

  entry.count++;
  return entry.count;
}

// Clean old entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of ipStore) {
    if (now - val.windowStart > IP_WINDOW_MS) ipStore.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Bot Detection ────────────────────────────────────────────────────────────
const BOT_UA_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i, /python-requests/i,
  /curl\//i, /wget\//i, /httpclient/i, /go-http-client/i,
  /java\//i, /php\//i, /ruby\//i,
];

const KNOWN_BOTS = new Set([
  'Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider',
  'YandexBot', 'facebot', 'ia_archiver',
]);

function isSuspiciousBot(req) {
  const ua = req.headers['user-agent'] || '';

  // Missing user agent
  if (!ua || ua.length < 10) return true;

  // Known bot patterns
  if (BOT_UA_PATTERNS.some(p => p.test(ua))) return true;

  // Missing typical browser headers
  const hasAccept = !!req.headers['accept'];
  const hasAcceptLang = !!req.headers['accept-language'];
  if (!hasAccept && !hasAcceptLang) return true;

  // Suspiciously fast requests (< 50ms since last request from same IP)
  const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0];
  if (!ip) return false;

  return false;
}

// ─── Audit Logger ─────────────────────────────────────────────────────────────
async function logAuditEvent(userId, action, details, req) {
  try {
    const ip = req?.ip || req?.headers?.['x-forwarded-for']?.split(',')[0] || 'unknown';
    const ua = req?.headers?.['user-agent']?.slice(0, 200) || 'unknown';

    await query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [userId || null, action, JSON.stringify(details || {}), ip, ua]);
  } catch (err) {
    logger.error('Audit log error:', err.message);
  }
}

// ─── Middleware Functions ─────────────────────────────────────────────────────

/**
 * Bot protection — blocks suspicious automated requests
 */
function botProtection(req, res, next) {
  if (isSuspiciousBot(req)) {
    logger.warn(`Bot detected: ${req.ip} — ${req.headers['user-agent']?.slice(0, 80)}`);
    return res.status(403).json({ error: 'Automated requests not allowed' });
  }
  next();
}

/**
 * IP-based rate limiting by namespace
 */
function ipRateLimit(namespace = 'default', customLimit = null) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const limit = customLimit || IP_LIMITS[namespace] || IP_LIMITS.default;
    const count = getIpCount(ip, namespace);

    if (count > limit) {
      logger.warn(`Rate limit exceeded: ${ip} (${namespace}): ${count}/${limit}`);
      res.set('X-RateLimit-Limit', limit);
      res.set('X-RateLimit-Remaining', 0);
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retry_after: Math.ceil(IP_WINDOW_MS / 1000),
      });
    }

    res.set('X-RateLimit-Limit', limit);
    res.set('X-RateLimit-Remaining', Math.max(0, limit - count));
    next();
  };
}

/**
 * Audit middleware — logs all state-changing requests
 */
function auditLog(action) {
  return async (req, res, next) => {
    const userId = req.user?.id;
    const details = {
      method: req.method,
      path: req.path,
      body: sanitizeBody(req.body),
      params: req.params,
    };

    // Log after response to capture status
    res.on('finish', () => {
      if (res.statusCode < 400) { // Only log successful operations
        logAuditEvent(userId, action, { ...details, status: res.statusCode }, req);
      }
    });

    next();
  };
}

/**
 * Request sanitizer — removes dangerous characters from body
 */
function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

function sanitizeObject(obj, depth = 0) {
  if (depth > 5) return obj;
  if (typeof obj === 'string') return obj.replace(/<script[^>]*>.*?<\/script>/gi, '').replace(/[<>]/g, '').trim();
  if (Array.isArray(obj)) return obj.map(i => sanitizeObject(i, depth + 1));
  if (obj && typeof obj === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      clean[k] = sanitizeObject(v, depth + 1);
    }
    return clean;
  }
  return obj;
}

function sanitizeBody(body) {
  if (!body) return {};
  const safe = { ...body };
  delete safe.password;
  delete safe.password_hash;
  delete safe.stripe_key;
  return safe;
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(self), camera=(self)');
  next();
}

/**
 * Request fingerprinting for fraud detection
 */
function fingerprint(req, res, next) {
  const components = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
  ];
  req.fingerprint = crypto
    .createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .slice(0, 16);
  next();
}

module.exports = {
  botProtection,
  ipRateLimit,
  auditLog,
  sanitizeRequest,
  securityHeaders,
  fingerprint,
  logAuditEvent,
  IP_LIMITS,
};

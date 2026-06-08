require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { securityHeaders, sanitizeRequest, fingerprint, botProtection } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook: needs raw body — before express.json()
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));

// ── Security ──────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://deal-hunter-ai-frontend.onrender.com',
  'https://deal-hunter-ai.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...ALLOWED_ORIGINS],
    },
  },
  crossOriginResourcePolicy: false,
}));
app.use(securityHeaders);
app.use(compression());

const corsOptions = {
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(sanitizeRequest);
app.use(fingerprint);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const limiterConfig = (max) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  message: { error: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test',
});

app.use('/api/', limiterConfig(500));
app.use('/api/auth/login', limiterConfig(10));      // 10 login attempts per 15 min
app.use('/api/auth/register', limiterConfig(5));    // 5 registrations per 15 min
app.use('/api/search', limiterConfig(60));
app.use('/api/admin', limiterConfig(100));

// Apply bot protection to public endpoints
app.use('/api/search', botProtection);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/search', require('./routes/search'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/scan', require('./routes/scan'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/markets', require('./routes/markets'));
app.use('/api/collaborators', require('./routes/collaborators'));
app.use('/api/feed', require('./routes/feed'));

// ── Health & Status ───────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const { pool } = require('./config/database');
  let dbStatus = 'ok';
  try { await pool.query('SELECT 1'); } catch { dbStatus = 'error'; }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    version: '4.0.0',
    db: dbStatus,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { message: err.message, stack: err.stack?.split('\n')[0], path: req.path });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 Deal Hunter AI v4.0 — port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  const { startScanJob } = require('./jobs/scanJob');
  startScanJob();
  const { startWorkerMonitor } = require('./services/workerMonitor');
  startWorkerMonitor();
});

module.exports = app; // for testing

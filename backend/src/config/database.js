const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'dealhunter',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  logger.info('📦 Nueva conexión a PostgreSQL establecida');
});

pool.on('error', (err) => {
  logger.error('Error en pool de PostgreSQL:', err);
});

// Helper para queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn(`Query lenta (${duration}ms): ${text}`);
    }
    return result;
  } catch (err) {
    logger.error('Error en query:', { text, params, error: err.message });
    throw err;
  }
};

module.exports = { pool, query };

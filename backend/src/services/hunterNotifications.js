const { query } = require('../config/database');
const logger = require('../utils/logger');

async function notify(userId, type, title, message, metadata = null) {
  try {
    await query(
      `INSERT INTO hunter_notifications (user_id, type, title, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, message, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    logger.warn(`[HunterNotif] failed user=${userId}: ${err.message}`);
  }
}

module.exports = { notify };

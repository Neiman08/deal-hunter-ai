/**
 * Migration: Add Harbor Freight and Wayfair to stores table.
 * Idempotent — uses ON CONFLICT DO NOTHING.
 */

const { query } = require('../config/database');
const logger    = require('../utils/logger');

const NEW_STORES = [
  {
    name:        'Harbor Freight',
    slug:        'harbor-freight',
    color:       '#E31837',
    website_url: 'https://www.harborfreight.com',
  },
  {
    name:        'Wayfair',
    slug:        'wayfair',
    color:       '#7B2D8B',
    website_url: 'https://www.wayfair.com',
  },
];

async function migrateNewStores() {
  for (const s of NEW_STORES) {
    try {
      await query(
        `INSERT INTO stores (name, slug, color, website_url, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name,
           color=EXCLUDED.color,
           website_url=EXCLUDED.website_url,
           is_active=true`,
        [s.name, s.slug, s.color, s.website_url]
      );
      logger.info(`[Migration:NewStores] Upserted store: ${s.slug}`);
    } catch (err) {
      logger.warn(`[Migration:NewStores] ${s.slug}: ${err.message}`);
    }
  }
}

module.exports = { migrateNewStores };

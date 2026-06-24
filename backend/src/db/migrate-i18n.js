const { query } = require('./index');

async function migrateI18n() {
  // preferred_language on users
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'en'
  `);
  console.log('[i18n] preferred_language column OK');

  // Bilingual columns on deal_posts (AI leader posts)
  await query(`ALTER TABLE deal_posts ADD COLUMN IF NOT EXISTS title_en TEXT`);
  await query(`ALTER TABLE deal_posts ADD COLUMN IF NOT EXISTS title_es TEXT`);
  await query(`ALTER TABLE deal_posts ADD COLUMN IF NOT EXISTS content_en TEXT`);
  await query(`ALTER TABLE deal_posts ADD COLUMN IF NOT EXISTS content_es TEXT`);
  console.log('[i18n] deal_posts bilingual columns OK');

  // Bilingual columns on business_missions
  await query(`ALTER TABLE business_missions ADD COLUMN IF NOT EXISTS title_en TEXT`);
  await query(`ALTER TABLE business_missions ADD COLUMN IF NOT EXISTS title_es TEXT`);
  await query(`ALTER TABLE business_missions ADD COLUMN IF NOT EXISTS description_en TEXT`);
  await query(`ALTER TABLE business_missions ADD COLUMN IF NOT EXISTS description_es TEXT`);
  console.log('[i18n] business_missions bilingual columns OK');

  console.log('[i18n] Migration complete.');
}

module.exports = { migrateI18n };

if (require.main === module) {
  migrateI18n().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

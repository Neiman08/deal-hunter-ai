require('dotenv').config({ path: '../../.env' });
const { pool } = require('../config/database');

async function migrateCollaborators() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔧 Running collaborators migration...');

    // ── Collaborator Profiles ─────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS collaborator_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      display_name VARCHAR(100),
      level VARCHAR(30) DEFAULT 'Rookie Hunter',
      points INTEGER DEFAULT 0,
      approved_deals_count INTEGER DEFAULT 0,
      rejected_deals_count INTEGER DEFAULT 0,
      pending_deals_count INTEGER DEFAULT 0,
      total_clicks_generated INTEGER DEFAULT 0,
      total_sales_estimated DECIMAL(10,2) DEFAULT 0,
      total_commission_estimated DECIMAL(10,2) DEFAULT 0,
      reputation_score DECIMAL(5,2) DEFAULT 100.0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ collaborator_profiles');

    // ── Submitted Deals ───────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS submitted_deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      collaborator_id UUID REFERENCES collaborator_profiles(id) ON DELETE SET NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
      product_name VARCHAR(500),
      brand VARCHAR(200),
      sku VARCHAR(100),
      upc VARCHAR(30),
      product_url VARCHAR(1000),
      image_url VARCHAR(1000),
      receipt_image_url VARCHAR(1000),
      shelf_image_url VARCHAR(1000),
      price_tag_image_url VARCHAR(1000),
      regular_price DECIMAL(10,2),
      found_price DECIMAL(10,2) NOT NULL,
      discount_percent DECIMAL(5,2),
      estimated_profit DECIMAL(10,2),
      zip_code VARCHAR(10),
      city VARCHAR(100),
      state VARCHAR(5),
      latitude DECIMAL(10,8),
      longitude DECIMAL(11,8),
      notes TEXT,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','duplicate','expired')),
      rejection_reason TEXT,
      admin_notes TEXT,
      approved_by UUID REFERENCES users(id),
      approved_at TIMESTAMP,
      created_deal_id UUID REFERENCES deals(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ submitted_deals');

    // ── Collaborator Points Log ───────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS collaborator_points_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      collaborator_id UUID REFERENCES collaborator_profiles(id) ON DELETE CASCADE,
      submitted_deal_id UUID REFERENCES submitted_deals(id) ON DELETE SET NULL,
      action VARCHAR(50) NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ collaborator_points_log');

    // ── Deal Confirmations ────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS deal_confirmations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      confirmation_type VARCHAR(20) NOT NULL CHECK (confirmation_type IN ('found','not_found','bought','sold','price_changed')),
      store_location VARCHAR(255),
      price_seen DECIMAL(10,2),
      image_url VARCHAR(1000),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ deal_confirmations');

    // ── Teams ─────────────────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS teams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      city VARCHAR(100),
      state VARCHAR(5),
      description TEXT,
      owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      points INTEGER DEFAULT 0,
      approved_deals_count INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ teams');

    // ── Team Members ──────────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS team_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'hunter' CHECK (role IN ('owner','manager','hunter')),
      joined_at TIMESTAMP DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true,
      UNIQUE(team_id, user_id)
    );`);
    console.log('  ✅ team_members');

    // ── Deal Posts (Feed) ─────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS deal_posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      collaborator_id UUID REFERENCES collaborator_profiles(id) ON DELETE SET NULL,
      deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
      submitted_deal_id UUID REFERENCES submitted_deals(id) ON DELETE SET NULL,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
      store_name VARCHAR(100),
      upc VARCHAR(30),
      sku VARCHAR(100),
      price DECIMAL(10,2),
      regular_price DECIMAL(10,2),
      discount_percent DECIMAL(5,2),
      estimated_profit DECIMAL(10,2),
      zip_code VARCHAR(10),
      city VARCHAR(100),
      state VARCHAR(5),
      latitude DECIMAL(10,8),
      longitude DECIMAL(11,8),
      confidence_score INTEGER DEFAULT 50 CHECK (confidence_score BETWEEN 0 AND 100),
      ai_score INTEGER DEFAULT 0 CHECK (ai_score BETWEEN 0 AND 100),
      ai_label VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','pending_review','approved','rejected','expired','hidden')),
      view_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ deal_posts');

    // ── Deal Post Images ──────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS deal_post_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES deal_posts(id) ON DELETE CASCADE,
      image_url VARCHAR(1000) NOT NULL,
      image_type VARCHAR(20) DEFAULT 'other' CHECK (image_type IN ('product','shelf','receipt','price_tag','other')),
      created_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ deal_post_images');

    // ── Deal Post Comments ────────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS deal_post_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES deal_posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      comment TEXT NOT NULL,
      image_url VARCHAR(1000),
      created_at TIMESTAMP DEFAULT NOW()
    );`);
    console.log('  ✅ deal_post_comments');

    // ── Deal Post Reactions ───────────────────────────────────────────────────
    await client.query(`CREATE TABLE IF NOT EXISTS deal_post_reactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES deal_posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      reaction VARCHAR(20) NOT NULL CHECK (reaction IN ('like','hot','verified','expired','not_found','bought','sold')),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(post_id, user_id, reaction)
    );`);
    console.log('  ✅ deal_post_reactions');

    // ── Add team_id to collaborator_profiles ──────────────────────────────────
    await client.query(`ALTER TABLE collaborator_profiles
      ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;`);
    console.log('  ✅ collaborator_profiles.team_id added');

    // ── Indexes ───────────────────────────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_submitted_deals_user    ON submitted_deals(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_submitted_deals_status  ON submitted_deals(status)`,
      `CREATE INDEX IF NOT EXISTS idx_submitted_deals_store   ON submitted_deals(store_id)`,
      `CREATE INDEX IF NOT EXISTS idx_collab_points_log       ON collaborator_points_log(collaborator_id)`,
      `CREATE INDEX IF NOT EXISTS idx_deal_posts_status       ON deal_posts(status)`,
      `CREATE INDEX IF NOT EXISTS idx_deal_posts_created      ON deal_posts(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_deal_post_reactions     ON deal_post_reactions(post_id)`,
      `CREATE INDEX IF NOT EXISTS idx_deal_post_comments      ON deal_post_comments(post_id)`,
      `CREATE INDEX IF NOT EXISTS idx_deal_confirmations_deal ON deal_confirmations(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_team_members_team       ON team_members(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_team_members_user       ON team_members(user_id)`,
    ];
    for (const idx of indexes) await client.query(idx);
    console.log('  ✅ Indexes created');

    await client.query('COMMIT');
    console.log('✅ Collaborators migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateCollaborators().catch(err => { console.error(err); process.exit(1); });

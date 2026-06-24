const { query } = require('../config/database');

async function migrateTeamsV2() {
  // ── teams: new columns ─────────────────────────────────────────────────────
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_type VARCHAR(20) DEFAULT 'national'`);
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS target_stores TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS target_categories TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS min_discount_pct INTEGER DEFAULT 20`);
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS min_roi_pct INTEGER DEFAULT 50`);
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS mission_brief TEXT`);
  await query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS ai_coach_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  console.log('[teams-v2] teams columns OK');

  // ── team_members: expand role constraint ──────────────────────────────────
  await query(`ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_role_check`);
  await query(`ALTER TABLE team_members ADD CONSTRAINT team_members_role_check
    CHECK (role IN ('owner','manager','hunter','verifier','ai_coach'))`);
  console.log('[teams-v2] team_members role constraint OK');

  // ── team_missions ─────────────────────────────────────────────────────────
  await query(`CREATE TABLE IF NOT EXISTS team_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    title_es VARCHAR(200),
    description TEXT,
    description_es TEXT,
    type VARCHAR(30) DEFAULT 'scan_deals',
    target_count INTEGER DEFAULT 10,
    reward_points INTEGER DEFAULT 50,
    is_active BOOLEAN DEFAULT true,
    ends_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  console.log('[teams-v2] team_missions OK');

  // ── team_mission_progress ─────────────────────────────────────────────────
  await query(`CREATE TABLE IF NOT EXISTS team_mission_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES team_missions(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    count INTEGER DEFAULT 0,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(mission_id, user_id)
  )`);
  console.log('[teams-v2] team_mission_progress OK');

  // ── team_activity ─────────────────────────────────────────────────────────
  await query(`CREATE TABLE IF NOT EXISTS team_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL,
    description TEXT,
    points_earned INTEGER DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_team_activity_team ON team_activity(team_id, created_at DESC)`);
  console.log('[teams-v2] team_activity OK');

  // ── seed Walmart Clearance Crew ───────────────────────────────────────────
  const teamRow = await query(`SELECT id FROM teams WHERE slug = 'walmart-clearance-crew' LIMIT 1`);
  if (teamRow.rows[0]) {
    const teamId = teamRow.rows[0].id;

    // Update team with v2 metadata
    await query(`UPDATE teams SET
      team_type = 'store',
      target_stores = ARRAY['Walmart'],
      target_categories = ARRAY['Electronics','Toys','Home & Garden','Sports'],
      min_discount_pct = 30,
      min_roi_pct = 60,
      mission_brief = 'Hunt Walmart clearance deals with 30%+ discount. Focus on electronics, toys, and seasonal sections. Minimum $5 profit per deal to qualify.'
      WHERE id = $1`, [teamId]);

    // Assign Walmart AI leader as coach
    const aiLeader = await query(`SELECT id FROM users WHERE ai_role = 'store_expert_walmart' AND is_ai_leader = true LIMIT 1`);
    if (aiLeader.rows[0]) {
      await query(`UPDATE teams SET ai_coach_id = $1 WHERE id = $2`, [aiLeader.rows[0].id, teamId]);
    }

    // Seed missions if none exist
    const existing = await query(`SELECT COUNT(*) FROM team_missions WHERE team_id = $1`, [teamId]);
    if (parseInt(existing.rows[0].count) === 0) {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await query(`INSERT INTO team_missions (team_id, title, title_es, description, description_es, type, target_count, reward_points, ends_at) VALUES
        ($1, 'Clearance Hunt Marathon', 'Maratón de Caza Clearance',
         'Scan 10 clearance deals at Walmart this week. Any department counts!',
         'Escanea 10 deals de clearance en Walmart esta semana. ¡Cualquier departamento cuenta!',
         'scan_deals', 10, 100, $2),
        ($1, 'Photo Evidence Drive', 'Campaña de Evidencia Fotográfica',
         'Submit 5 deals with shelf photos showing the clearance price tag.',
         'Envía 5 deals con fotos del estante mostrando la etiqueta de precio clearance.',
         'submit_deals', 5, 75, $2),
        ($1, 'Verification Squad', 'Escuadrón de Verificación',
         'Verify 8 deals submitted by other team hunters. Help the team earn trust!',
         'Verifica 8 deals enviados por otros cazadores. ¡Ayuda al equipo a ganar confianza!',
         'verify_deals', 8, 60, $2),
        ($1, 'Team Recruiter', 'Reclutador del Equipo',
         'Invite 2 new hunters to join Walmart Clearance Crew.',
         'Invita a 2 nuevos cazadores a unirse al Walmart Clearance Crew.',
         'invite_members', 2, 30, $2)
      `, [teamId, nextWeek.toISOString()]);
      console.log('[teams-v2] Walmart Clearance Crew missions seeded');
    }

    // Seed initial welcome activity if empty
    const actCount = await query(`SELECT COUNT(*) FROM team_activity WHERE team_id = $1`, [teamId]);
    if (parseInt(actCount.rows[0].count) === 0) {
      await query(`INSERT INTO team_activity (team_id, user_id, action_type, description, points_earned)
        VALUES ($1, NULL, 'coach_tip', 'Welcome to Walmart Clearance Crew! Check the clearance aisle first — markdowns happen Monday mornings. Look for yellow tags in Electronics and Toys.', 0)`,
        [teamId]);
    }
  }

  console.log('[teams-v2] Migration complete.');
}

module.exports = { migrateTeamsV2 };

if (require.main === module) {
  migrateTeamsV2().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

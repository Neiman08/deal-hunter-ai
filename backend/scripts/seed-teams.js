/**
 * seed-teams.js
 * Creates 4 demo teams with 3 members each for Deal Hunter AI.
 * Safe to re-run: skips if teams already exist.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

const TEAMS = [
  {
    name: 'Chicago Hunters',
    slug: 'chicago-hunters',
    city: 'Chicago',
    state: 'IL',
    description: 'Best deal hunters in the Chicago metro area. Clearance kings since 2023.',
    points: 1840,
    approved_deals_count: 67,
    members: [
      { name: 'Marcus Webb',    email: 'marcus.webb@demo.dh',    display: 'MarcusW',    points: 920, approved: 34, level: 'Silver Hunter', role: 'owner' },
      { name: 'Priya Sharma',   email: 'priya.sharma@demo.dh',   display: 'PriyaS',     points: 620, approved: 22, level: 'Bronze Hunter', role: 'manager' },
      { name: 'Jordan Lee',     email: 'jordan.lee@demo.dh',     display: 'JordanL',    points: 300, approved: 11, level: 'Bronze Hunter', role: 'hunter' },
    ],
  },
  {
    name: 'Walmart Clearance Crew',
    slug: 'walmart-clearance-crew',
    city: 'Houston',
    state: 'TX',
    description: 'Dedicated to finding the deepest Walmart clearance markdowns. Join us!',
    points: 2350,
    approved_deals_count: 91,
    members: [
      { name: 'Tanya Brooks',   email: 'tanya.brooks@demo.dh',   display: 'TanyaB',     points: 1100, approved: 41, level: 'Gold Hunter',   role: 'owner' },
      { name: 'Carlos Ruiz',    email: 'carlos.ruiz@demo.dh',    display: 'CarlosR',    points: 780,  approved: 29, level: 'Silver Hunter', role: 'manager' },
      { name: 'Alexis Grant',   email: 'alexis.grant@demo.dh',   display: 'AlexisG',    points: 470,  approved: 21, level: 'Bronze Hunter', role: 'hunter' },
    ],
  },
  {
    name: 'Target Deal Squad',
    slug: 'target-deal-squad',
    city: 'Minneapolis',
    state: 'MN',
    description: 'Target clearance specialists. We find the red tags before anyone else.',
    points: 1520,
    approved_deals_count: 58,
    members: [
      { name: 'Rachel Kim',     email: 'rachel.kim@demo.dh',     display: 'RachelK',    points: 720,  approved: 28, level: 'Silver Hunter', role: 'owner' },
      { name: 'Devon Pierce',   email: 'devon.pierce@demo.dh',   display: 'DevonP',     points: 510,  approved: 19, level: 'Bronze Hunter', role: 'manager' },
      { name: 'Sam Torres',     email: 'sam.torres@demo.dh',     display: 'SamT',       points: 290,  approved: 11, level: 'Bronze Hunter', role: 'hunter' },
    ],
  },
  {
    name: 'Best Buy Flippers',
    slug: 'bestbuy-flippers',
    city: 'Los Angeles',
    state: 'CA',
    description: 'Electronics resellers hunting Best Buy open-box and clearance deals.',
    points: 3100,
    approved_deals_count: 118,
    members: [
      { name: 'Tyler Mason',    email: 'tyler.mason@demo.dh',    display: 'TylerM',     points: 1580, approved: 57, level: 'Elite Hunter',  role: 'owner' },
      { name: 'Sofia Nguyen',   email: 'sofia.nguyen@demo.dh',   display: 'SofiaN',     points: 960,  approved: 38, level: 'Gold Hunter',   role: 'manager' },
      { name: 'Eli Jordan',     email: 'eli.jordan@demo.dh',     display: 'EliJ',       points: 560,  approved: 23, level: 'Bronze Hunter', role: 'hunter' },
    ],
  },
];

async function run() {
  const existing = await q('SELECT COUNT(*) FROM teams');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`Teams already seeded (${existing.rows[0].count} teams). Skipping.`);
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash('DemoUser2024!', 10);
  console.log('Starting team seed...');

  for (const teamData of TEAMS) {
    const memberIds = [];

    // Create users + collaborator profiles for each member
    for (const m of teamData.members) {
      // Upsert user
      let userRow = await q('SELECT id FROM users WHERE email = $1', [m.email]);
      let userId;
      if (userRow.rows[0]) {
        userId = userRow.rows[0].id;
      } else {
        const inserted = await q(
          `INSERT INTO users (email, password_hash, name, plan, is_active)
           VALUES ($1, $2, $3, 'free', true) RETURNING id`,
          [m.email, passwordHash, m.name]
        );
        userId = inserted.rows[0].id;
      }

      // Upsert collaborator profile
      let cpRow = await q('SELECT id FROM collaborator_profiles WHERE user_id = $1', [userId]);
      let cpId;
      if (cpRow.rows[0]) {
        cpId = cpRow.rows[0].id;
        await q(
          `UPDATE collaborator_profiles SET display_name=$1, points=$2, approved_deals_count=$3, level=$4 WHERE id=$5`,
          [m.display, m.points, m.approved, m.level, cpId]
        );
      } else {
        const inserted = await q(
          `INSERT INTO collaborator_profiles (user_id, display_name, points, approved_deals_count, level, is_active)
           VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
          [userId, m.display, m.points, m.approved, m.level]
        );
        cpId = inserted.rows[0].id;
      }
      memberIds.push({ userId, cpId, role: m.role });
    }

    // Get owner userId
    const ownerUserId = memberIds[0].userId;

    // Create team
    const teamRow = await q(
      `INSERT INTO teams (name, slug, city, state, description, owner_user_id, points, approved_deals_count, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
      [teamData.name, teamData.slug, teamData.city, teamData.state, teamData.description, ownerUserId, teamData.points, teamData.approved_deals_count]
    );
    const teamId = teamRow.rows[0].id;
    console.log(`  Created team: ${teamData.name} (${teamId})`);

    // Add members
    for (const { userId, cpId, role } of memberIds) {
      await q(
        `INSERT INTO team_members (team_id, user_id, role, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (team_id, user_id) DO UPDATE SET role=$3, is_active=true`,
        [teamId, userId, role]
      );
      // Link collaborator profile to team
      await q('UPDATE collaborator_profiles SET team_id=$1 WHERE id=$2', [teamId, cpId]);
    }
  }

  const final = await q('SELECT name, points, approved_deals_count FROM teams ORDER BY points DESC');
  console.log('\nSeeded teams:');
  final.rows.forEach((t, i) => console.log(`  ${i+1}. ${t.name} — ${t.points} pts, ${t.approved_deals_count} deals`));
  console.log('\nDone.');
  await pool.end();
}

run().catch(e => { console.error(e); pool.end(); process.exit(1); });

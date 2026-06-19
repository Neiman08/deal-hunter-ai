/**
 * businessActions.js — Fire-and-forget XP/mission tracking hooks.
 *
 * Called from scanner.js and community.js after the main response is sent.
 * All functions catch their own errors so they never break the caller.
 */

const { query } = require('../config/database');
const logger    = require('../utils/logger');

// ── Scan debounce (in-memory, per process) ─────────────────────────────────────
// Prevents awarding XP when the same user scans the same code < 5 min apart.
const _recentScans = new Map(); // key: `userId:code` → timestamp ms
const SCAN_DEBOUNCE_MS = 5 * 60 * 1000;

function _isScanDebounced(userId, code) {
  const key = `${userId}:${code}`;
  const last = _recentScans.get(key);
  if (last && Date.now() - last < SCAN_DEBOUNCE_MS) return true;
  _recentScans.set(key, Date.now());
  // GC: prune old entries when the map grows large
  if (_recentScans.size > 5000) {
    const cutoff = Date.now() - SCAN_DEBOUNCE_MS;
    for (const [k, ts] of _recentScans) if (ts < cutoff) _recentScans.delete(k);
  }
  return false;
}

// ── Transaction log ────────────────────────────────────────────────────────────
async function logTransaction(userId, type, { xp = 0, points = 0, amount = 0, status = 'approved', refType, refId, description } = {}) {
  try {
    await query(`
      INSERT INTO hunter_transactions
        (user_id, type, xp_delta, points_delta, amount_delta, status, reference_type, reference_id, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [userId, type, xp, points, amount, status, refType || null, refId || null, description || null]);
  } catch (e) {
    logger.warn(`[BusinessActions] logTransaction: ${e.message}`);
  }
}

// ── Mission increment ──────────────────────────────────────────────────────────
// Finds all active missions for the given action, increments progress,
// and awards XP if a mission just completed.
async function incrementMission(userId, action) {
  try {
    const missRes = await query(
      `SELECT id, slug, type, target, xp_reward FROM business_missions WHERE action=$1 AND is_active=true`,
      [action]
    );

    for (const m of missRes.rows) {
      const periodExpr = {
        daily:     'CURRENT_DATE',
        weekly:    "date_trunc('week', CURRENT_DATE)::date",
        monthly:   "date_trunc('month', CURRENT_DATE)::date",
        permanent: "'2000-01-01'::date",
      }[m.type] || 'CURRENT_DATE';

      const upd = await query(`
        INSERT INTO business_mission_progress (user_id, mission_id, progress, period)
        VALUES ($1, $2, 1, ${periodExpr})
        ON CONFLICT (user_id, mission_id, period)
        DO UPDATE SET
          progress   = LEAST(business_mission_progress.progress + 1, $3),
          updated_at = NOW()
        RETURNING progress, completed, rewarded
      `, [userId, m.id, m.target]);

      const prog = upd.rows[0];
      if (!prog) continue;

      const justCompleted = prog.progress >= m.target && !prog.completed && !prog.rewarded;
      if (!justCompleted) continue;

      // Mark done
      await query(`
        UPDATE business_mission_progress
        SET completed=true, rewarded=true, completed_at=NOW()
        WHERE user_id=$1 AND mission_id=$2 AND period=${periodExpr}
      `, [userId, m.id]);

      // Award XP
      const xp = m.xp_reward;
      await query(`
        UPDATE collaborator_profiles
        SET points = points + $1, xp_this_month = xp_this_month + $1, updated_at=NOW()
        WHERE user_id=$2
      `, [xp, userId]);

      // Lifetime points in wallet
      await query(`
        INSERT INTO contributor_wallets (user_id, lifetime_points)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
        SET lifetime_points = contributor_wallets.lifetime_points + $2, updated_at=NOW()
      `, [userId, xp]);

      // Log the XP award
      await query(`
        INSERT INTO collaborator_points_log (collaborator_id, action, points, description)
        SELECT id, 'mission_complete', $1, $2 FROM collaborator_profiles WHERE user_id=$3
      `, [xp, `Mission: ${m.slug}`, userId]);

      await logTransaction(userId, 'mission_completed', {
        xp, status: 'approved', refType: 'mission', refId: m.id,
        description: `Mission completed: ${m.title || m.slug} (+${xp} XP)`,
      });

      logger.info(`[BusinessActions] mission done: user=${userId} slug=${m.slug} xp=+${xp}`);
    }
  } catch (e) {
    logger.warn(`[BusinessActions] incrementMission(${action}): ${e.message}`);
  }
}

// ── Public hooks ───────────────────────────────────────────────────────────────

/**
 * Call after a valid UPC/barcode scan.
 * - Debounces same code within 5 min per user
 * - +1 XP per unique scan
 * - Increments scan missions (daily + weekly)
 */
async function trackScan(userId, code) {
  if (_isScanDebounced(userId, code)) return;

  try {
    // +1 XP — no-op if no collaborator profile yet (UPDATE affects 0 rows safely)
    await query(`
      UPDATE collaborator_profiles
      SET scan_count    = scan_count + 1,
          points        = points + 1,
          xp_this_month = xp_this_month + 1,
          updated_at    = NOW()
      WHERE user_id = $1
    `, [userId]);

    await incrementMission(userId, 'scan_product');

    await logTransaction(userId, 'scan_product', {
      xp: 1, status: 'approved', refType: 'scan', refId: code,
      description: `Scanner lookup: ${code}`,
    });
  } catch (e) {
    logger.warn(`[BusinessActions] trackScan: ${e.message}`);
  }
}

/**
 * Call after POST /scanner/submit-deal succeeds.
 * - Increments submit missions
 * - Logs pending transaction (points awarded only on verification)
 */
async function trackSubmitDeal(userId, dealId, roiPercent) {
  try {
    await incrementMission(userId, 'submit_deal');

    if (roiPercent != null && parseFloat(roiPercent) >= 50) {
      await incrementMission(userId, 'high_roi_deal');
    }

    await logTransaction(userId, 'submit_deal', {
      status: 'pending', refType: 'submitted_deal', refId: dealId,
      description: 'Deal submitted — XP pending verification',
    });
  } catch (e) {
    logger.warn(`[BusinessActions] trackSubmitDeal: ${e.message}`);
  }
}

/**
 * Call after POST /community/deals/:id/confirm succeeds.
 * - +3 XP immediately (community service)
 * - Increments confirm missions
 * - Logs approved transaction
 * NOTE: The existing awardPoints() in community.js already grants 5 pts.
 *       We add 3 XP here as a separate Business-layer reward.
 */
async function trackConfirmDeal(userId, dealId) {
  try {
    // +3 XP to collaborator_profiles (separate from community.js awardPoints)
    await query(`
      UPDATE collaborator_profiles
      SET points        = points + 3,
          xp_this_month = xp_this_month + 3,
          updated_at    = NOW()
      WHERE user_id = $1
    `, [userId]);

    await incrementMission(userId, 'confirm_deal');

    await logTransaction(userId, 'confirm_deal', {
      xp: 3, status: 'approved', refType: 'submitted_deal', refId: dealId,
      description: 'Confirmed community deal (+3 XP)',
    });
  } catch (e) {
    logger.warn(`[BusinessActions] trackConfirmDeal: ${e.message}`);
  }
}

module.exports = { trackScan, trackSubmitDeal, trackConfirmDeal, logTransaction };

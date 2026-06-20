const { query } = require('../config/database');
const logger = require('../utils/logger');

function computeTrustLevel(score) {
  if (score >= 85) return 'Excelente';
  if (score >= 70) return 'Bueno';
  if (score >= 50) return 'Normal';
  if (score >= 30) return 'En observación';
  return 'Suspendido';
}

async function recalcTrust(userId) {
  try {
    const res = await query(
      `SELECT approved_deals_count, rejected_deals_count, duplicate_reports, suspicious_activity
       FROM collaborator_profiles WHERE user_id = $1`,
      [userId]
    );
    if (!res.rows[0]) return;
    const { approved_deals_count: v, rejected_deals_count: r, duplicate_reports: d, suspicious_activity: sus } = res.rows[0];

    let score = 50;
    score += Math.min(30, (v || 0) * 5);
    score -= (r || 0) * 8;
    score -= (d || 0) * 5;
    if (sus) score -= 30;
    score = Math.max(0, Math.min(100, score));

    const trust_level = computeTrustLevel(score);
    const fraud_score = 100 - score;

    await query(
      `UPDATE collaborator_profiles
       SET trust_score = $1, trust_level = $2, fraud_score = $3, verified_reports = $4, updated_at = NOW()
       WHERE user_id = $5`,
      [score, trust_level, fraud_score, v || 0, userId]
    );
    return { score, trust_level, fraud_score };
  } catch (err) {
    logger.warn(`[TrustService] recalc failed user=${userId}: ${err.message}`);
  }
}

module.exports = { recalcTrust, computeTrustLevel };

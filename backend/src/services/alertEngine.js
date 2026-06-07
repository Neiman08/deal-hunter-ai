/**
 * Alert Engine — Phase 6
 *
 * Scans active deals against user watchlist_items and user_alerts.
 * Fires notifications when ROI > 50% or profit > $50 (configurable).
 *
 * Trigger rules:
 *  - watchlist_items: type=brand/category/keyword/product_id
 *    → trigger when deal matches AND (roi > 50 OR profit > 50)
 *  - user_alerts: keyword/store/category filter + min thresholds
 *    → trigger when matching deal meets min_discount + min_profit + min_score
 *
 * Dedup: alert_triggers table prevents re-notifying same alert+deal.
 * WhatsApp: only for plan='elite' users with whatsapp_number configured.
 */

const { query } = require('../config/database');
const logger    = require('../utils/logger');

// ─── Check watchlist matches ──────────────────────────────────────────────────
async function checkWatchlistAlerts() {
  logger.info('[AlertEngine] Checking watchlist alerts...');

  const res = await query(`
    SELECT
      w.id      AS watchlist_id,
      w.user_id,
      w.type,
      w.value,
      w.label,
      w.min_discount,
      w.notify_whatsapp,
      u.plan,
      u.preferences->>'whatsapp_number' AS whatsapp_number,
      d.id      AS deal_id,
      d.deal_price,
      d.regular_price,
      d.discount_percent,
      d.estimated_profit,
      d.roi_percent,
      d.opportunity_score,
      d.opportunity_tier,
      d.opportunity_label,
      p.name    AS product_name,
      p.brand,
      p.product_url,
      s.name    AS store_name
    FROM watchlist_items w
    JOIN users u ON u.id = w.user_id
    JOIN deals d ON (
      -- brand match
      (w.type = 'brand'    AND LOWER(d.product_id::text) IN (
        SELECT LOWER(id::text) FROM products WHERE LOWER(brand) = LOWER(w.value)
      ))
      OR
      -- keyword match (searches product name)
      (w.type = 'keyword'  AND EXISTS (
        SELECT 1 FROM products p2 WHERE p2.id = d.product_id
          AND LOWER(p2.name) LIKE '%' || LOWER(w.value) || '%'
      ))
      OR
      -- category match
      (w.type = 'category' AND EXISTS (
        SELECT 1 FROM products p3 JOIN categories c ON c.id=p3.category_id
        WHERE p3.id=d.product_id AND LOWER(c.slug)=LOWER(w.value)
      ))
      OR
      -- direct product_id match
      (w.type = 'product_id' AND d.product_id::text = w.value)
    )
    JOIN products p ON p.id = d.product_id
    JOIN stores s   ON s.id = d.store_id
    WHERE w.is_active = true
      AND d.is_active = true
      AND d.discount_percent >= w.min_discount
      AND (d.roi_percent > 50 OR d.estimated_profit > 50)
      AND NOT EXISTS (
        SELECT 1 FROM alert_triggers at2
        WHERE at2.alert_id IS NULL  -- watchlist alerts have no alert_id
          AND at2.deal_id = d.id
          AND at2.user_id = w.user_id
          AND at2.triggered_at > NOW() - INTERVAL '24 hours'
      )
    LIMIT 100
  `);

  const triggered = res.rows;
  if (!triggered.length) {
    logger.info('[AlertEngine] No new watchlist matches.');
    return { triggered: 0 };
  }

  logger.info(`[AlertEngine] ${triggered.length} watchlist matches to process`);
  let sent = 0;

  for (const match of triggered) {
    try {
      // Log the trigger (dedup record)
      await query(`
        INSERT INTO alert_triggers (user_id, deal_id, channel, status, roi_at_trigger, profit_at_trigger)
        VALUES ($1, $2, 'push', 'pending', $3, $4)
        ON CONFLICT DO NOTHING
      `, [match.user_id, match.deal_id, match.roi_percent, match.estimated_profit]);

      // Create notification record
      await query(`
        INSERT INTO notifications (user_id, deal_id, channel, status, message_body)
        VALUES ($1, $2, 'push', 'sent', $3)
      `, [
        match.user_id,
        match.deal_id,
        buildNotificationMessage(match),
      ]);

      // WhatsApp for elite users
      if (match.notify_whatsapp && match.plan === 'elite' && match.whatsapp_number) {
        await sendWhatsAppAlert(match).catch(e =>
          logger.warn(`[AlertEngine] WhatsApp failed for ${match.user_id}: ${e.message}`)
        );
      }

      sent++;
    } catch (e) {
      logger.error(`[AlertEngine] Failed for deal ${match.deal_id}: ${e.message}`);
    }
  }

  logger.info(`[AlertEngine] ${sent}/${triggered.length} notifications sent`);
  return { triggered: triggered.length, sent };
}

// ─── Check user_alerts table ──────────────────────────────────────────────────
async function checkConfiguredAlerts() {
  logger.info('[AlertEngine] Checking configured user alerts...');

  const res = await query(`
    SELECT
      ua.id     AS alert_id,
      ua.user_id,
      ua.name   AS alert_name,
      ua.min_discount_percent,
      ua.min_profit,
      ua.min_score,
      ua.notify_whatsapp,
      u.plan,
      u.preferences->>'whatsapp_number' AS whatsapp_number,
      d.id      AS deal_id,
      d.deal_price,
      d.regular_price,
      d.discount_percent,
      d.estimated_profit,
      d.roi_percent,
      d.opportunity_score,
      d.opportunity_tier,
      d.opportunity_label,
      p.name    AS product_name,
      p.brand,
      p.product_url,
      s.name    AS store_name
    FROM user_alerts ua
    JOIN users u ON u.id = ua.user_id
    JOIN deals d ON (
      (ua.store_id IS NULL OR d.store_id = ua.store_id)
      AND (ua.product_keyword IS NULL OR EXISTS (
        SELECT 1 FROM products p2 WHERE p2.id=d.product_id
          AND LOWER(p2.name) LIKE '%' || LOWER(ua.product_keyword) || '%'
      ))
      AND (ua.category_id IS NULL OR EXISTS (
        SELECT 1 FROM products p3 WHERE p3.id=d.product_id AND p3.category_id=ua.category_id
      ))
    )
    JOIN products p ON p.id = d.product_id
    JOIN stores s ON s.id = d.store_id
    WHERE ua.is_active = true
      AND d.is_active = true
      AND d.discount_percent >= ua.min_discount_percent
      AND d.estimated_profit >= ua.min_profit
      AND d.opportunity_score >= ua.min_score
      AND NOT EXISTS (
        SELECT 1 FROM alert_triggers at2
        WHERE at2.alert_id = ua.id
          AND at2.deal_id = d.id
          AND at2.triggered_at > NOW() - INTERVAL '24 hours'
      )
    LIMIT 50
  `);

  const matches = res.rows;
  if (!matches.length) return { triggered: 0 };

  let sent = 0;
  for (const match of matches) {
    try {
      await query(`
        INSERT INTO alert_triggers (alert_id, user_id, deal_id, channel, status, roi_at_trigger, profit_at_trigger)
        VALUES ($1, $2, $3, 'push', 'pending', $4, $5)
        ON CONFLICT (alert_id, deal_id) DO NOTHING
      `, [match.alert_id, match.user_id, match.deal_id, match.roi_percent, match.estimated_profit]);

      await query(`
        INSERT INTO notifications (user_id, deal_id, alert_id, channel, status, message_body)
        VALUES ($1, $2, $3, 'push', 'sent', $4)
      `, [match.user_id, match.deal_id, match.alert_id, buildNotificationMessage(match)]);

      sent++;
    } catch (e) {
      logger.error(`[AlertEngine] Alert ${match.alert_id} failed: ${e.message}`);
    }
  }

  return { triggered: matches.length, sent };
}

function buildNotificationMessage(match) {
  const savings = (parseFloat(match.regular_price) - parseFloat(match.deal_price)).toFixed(2);
  return (
    `🔥 ${match.opportunity_tier || match.opportunity_label}: ${match.product_name}\n` +
    `💰 $${match.deal_price} (was $${match.regular_price}, save $${savings})\n` +
    `📊 Score: ${match.opportunity_score}/100 | ROI: ${match.roi_percent}% | Profit: $${match.estimated_profit}\n` +
    `🏪 ${match.store_name}\n` +
    `🔗 ${match.product_url}`
  );
}

async function sendWhatsAppAlert(match) {
  const twilio = require('twilio');
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to:   `whatsapp:${match.whatsapp_number}`,
    body: buildNotificationMessage(match),
  });
}

/**
 * Run all alert checks — call this after each discovery cycle.
 */
async function runAlertEngine() {
  try {
    const [watchlist, configured] = await Promise.all([
      checkWatchlistAlerts(),
      checkConfiguredAlerts(),
    ]);
    logger.info(`[AlertEngine] Done: watchlist=${watchlist.triggered} configured=${configured.triggered}`);
    return { watchlist, configured };
  } catch (e) {
    logger.error('[AlertEngine] Error:', e.message);
    return { error: e.message };
  }
}

module.exports = { runAlertEngine, checkWatchlistAlerts, checkConfiguredAlerts };

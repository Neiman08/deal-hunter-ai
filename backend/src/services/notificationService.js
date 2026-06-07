/**
 * Notification Service v2
 * Channels: Email (nodemailer), WhatsApp (Twilio), Push (future)
 * Triggers: Score >= 90, watchlist match, user alert match
 */

const nodemailer = require('nodemailer');
const { query } = require('../config/database');
const logger = require('../utils/logger');

// ─── Email Transport ──────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ─── Twilio WhatsApp ──────────────────────────────────────────────────────────
function getTwilio() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  return require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// ─── Email Template ───────────────────────────────────────────────────────────
function buildEmailHTML(deal) {
  const scoreColor = deal.opportunity_score >= 91 ? '#00ff88' : deal.opportunity_score >= 71 ? '#00d4ff' : '#fbbf24';
  const profit = deal.estimated_profit ? `$${parseFloat(deal.estimated_profit).toFixed(0)}` : 'N/A';
  const roi = deal.roi_percent ? `${Math.round(deal.roi_percent)}%` : 'N/A';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#05050a;color:#fff;padding:24px}
  .wrap{max-width:560px;margin:0 auto;background:#0a0a13;border-radius:20px;overflow:hidden;border:1px solid #1a1a2e}
  .header{background:linear-gradient(135deg,${scoreColor}22,#00d4ff11);padding:28px 24px;border-bottom:1px solid ${scoreColor}33}
  .logo{display:flex;align-items:center;gap:10px;margin-bottom:16px}
  .logo-icon{width:36px;height:36px;background:${scoreColor}22;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
  .logo-text{font-weight:800;font-size:16px;color:#fff}
  .alert-badge{display:inline-block;background:#ef444420;border:1px solid #ef4444;color:#ef4444;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px}
  .body{padding:24px}
  .product-name{font-size:20px;font-weight:800;color:#fff;margin-bottom:4px;line-height:1.3}
  .store-name{font-size:13px;color:#6b7280;margin-bottom:20px}
  .price-row{display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap}
  .deal-price{font-size:42px;font-weight:900;color:${scoreColor};line-height:1}
  .regular-price{font-size:20px;color:#374151;text-decoration:line-through}
  .discount-badge{background:#ef444422;border:1px solid #ef4444;color:#ef4444;padding:6px 14px;border-radius:12px;font-weight:800;font-size:16px}
  .metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
  .metric{background:#13131f;border-radius:12px;padding:14px;text-align:center}
  .metric-val{font-size:22px;font-weight:800}
  .metric-label{font-size:11px;color:#6b7280;margin-top:4px}
  .score-val{color:${scoreColor}}
  .profit-val{color:#00ff88}
  .roi-val{color:#00d4ff}
  .resale-box{background:#13131f;border:1px solid #1a1a2e;border-radius:14px;padding:16px;margin-bottom:20px}
  .resale-title{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}
  .resale-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a2e;font-size:14px}
  .resale-row:last-child{border-bottom:none}
  .resale-platform{color:#9ca3af}
  .resale-price{font-weight:700;color:#fff}
  .cta-btn{display:block;background:${scoreColor};color:#000;padding:16px 24px;border-radius:12px;text-decoration:none;font-weight:800;font-size:16px;text-align:center;margin-bottom:12px}
  .footer{padding:16px 24px;background:#0a0a13;border-top:1px solid #1a1a2e;text-align:center;font-size:12px;color:#374151}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div class="logo-text">Deal Hunter AI</div>
    </div>
    <span class="alert-badge">🚨 Nueva Oportunidad</span>
    <div class="product-name">${deal.product_name || deal.name}</div>
    <div class="store-name">${deal.store_name}</div>
  </div>
  <div class="body">
    <div class="price-row">
      <div class="deal-price">$${parseFloat(deal.deal_price).toFixed(0)}</div>
      <div class="regular-price">$${parseFloat(deal.regular_price).toFixed(0)}</div>
      <div class="discount-badge">-${Math.round(deal.discount_percent)}%</div>
    </div>
    <div class="metrics">
      <div class="metric"><div class="metric-val score-val">${deal.opportunity_score}</div><div class="metric-label">Score</div></div>
      <div class="metric"><div class="metric-val profit-val">${profit}</div><div class="metric-label">Est. Profit</div></div>
      <div class="metric"><div class="metric-val roi-val">${roi}</div><div class="metric-label">ROI</div></div>
    </div>
    ${deal.resale_price_amazon ? `
    <div class="resale-box">
      <div class="resale-title">Resale Estimations</div>
      <div class="resale-row"><span class="resale-platform">Amazon</span><span class="resale-price">$${deal.resale_price_amazon}</span></div>
      <div class="resale-row"><span class="resale-platform">eBay</span><span class="resale-price">$${deal.resale_price_ebay || '—'}</span></div>
      <div class="resale-row"><span class="resale-platform">FB Marketplace</span><span class="resale-price">$${deal.resale_price_facebook || '—'}</span></div>
    </div>` : ''}
    <a class="cta-btn" href="${process.env.FRONTEND_URL || 'https://dealhunter.ai'}/deal/${deal.id}">Ver Oportunidad Completa →</a>
  </div>
  <div class="footer">Deal Hunter AI · <a href="${process.env.FRONTEND_URL}/alerts" style="color:#6b7280">Gestionar alertas</a></div>
</div>
</body></html>`;
}

// ─── WhatsApp Message Template ────────────────────────────────────────────────
function buildWhatsAppMessage(deal) {
  const profit = deal.estimated_profit ? `$${Math.round(deal.estimated_profit)}` : 'N/A';
  const scoreEmoji = deal.opportunity_score >= 91 ? '🔥' : deal.opportunity_score >= 71 ? '💎' : '✅';
  return `${scoreEmoji} *DEAL HUNTER AI — Nueva Oportunidad*

*${deal.product_name || deal.name}*
📍 ${deal.store_name}

💰 Precio: *$${parseFloat(deal.deal_price).toFixed(0)}*
🏷️ Regular: $${parseFloat(deal.regular_price).toFixed(0)}
📉 Descuento: *-${Math.round(deal.discount_percent)}%*

📊 Score: *${deal.opportunity_score}/100*
💵 Ganancia estimada: *${profit}*
📈 ROI: ${deal.roi_percent ? Math.round(deal.roi_percent) + '%' : 'N/A'}

🛒 Ver en app: ${process.env.FRONTEND_URL || 'https://dealhunter.ai'}/deal/${deal.id}

_Responde STOP para cancelar alertas_`;
}

// ─── Send Email ───────────────────────────────────────────────────────────────
async function sendEmailAlert(toEmail, deal) {
  if (!process.env.SMTP_USER) {
    logger.info(`[EMAIL DEMO] Would send to ${toEmail}: ${deal.product_name || deal.name} ${deal.opportunity_score} score`);
    return true;
  }
  try {
    await transporter.sendMail({
      from: `"Deal Hunter AI" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `🚨 ${deal.opportunity_score}/100 Score — ${deal.product_name || deal.name} (-${Math.round(deal.discount_percent)}%)`,
      html: buildEmailHTML(deal),
    });
    logger.info(`📧 Email sent to ${toEmail}`);
    return true;
  } catch (err) {
    logger.error(`Email error to ${toEmail}:`, err.message);
    return false;
  }
}

// ─── Send WhatsApp ────────────────────────────────────────────────────────────
async function sendWhatsAppAlert(toNumber, deal) {
  const client = getTwilio();
  if (!client) {
    logger.info(`[WHATSAPP DEMO] Would send to ${toNumber}: Score ${deal.opportunity_score} — ${deal.product_name || deal.name}`);
    return true;
  }
  try {
    // Ensure number is in E.164 format with whatsapp: prefix
    const formatted = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber.startsWith('+') ? toNumber : '+1' + toNumber.replace(/\D/g, '')}`;
    const from = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`;

    await client.messages.create({
      body: buildWhatsAppMessage(deal),
      from,
      to: formatted,
    });
    logger.info(`📱 WhatsApp sent to ${toNumber}`);
    return true;
  } catch (err) {
    logger.error(`WhatsApp error to ${toNumber}:`, err.message);
    return false;
  }
}

// ─── Process Alerts (called by cron job) ─────────────────────────────────────
async function processAlerts() {
  logger.info('🔔 Processing alerts...');

  // Get recent high-score deals (last 35 minutes)
  const deals = await query(`
    SELECT d.*, p.name as product_name, s.name as store_name, s.slug as store_slug,
      c.slug as category_slug
    FROM deals d
    JOIN products p ON d.product_id = p.id
    JOIN stores s ON d.store_id = s.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE d.detected_at > NOW() - INTERVAL '35 minutes'
      AND d.is_active = true
      AND d.opportunity_score >= 70
    ORDER BY d.opportunity_score DESC
    LIMIT 50
  `);

  if (!deals.rows.length) {
    logger.info('No new deals to alert on');
    return 0;
  }

  // Get all active alerts with user info including WhatsApp number
  const alerts = await query(`
    SELECT a.*, u.email, u.plan, u.name as user_name,
      u.preferences->>'whatsapp_number' as whatsapp_number,
      s.slug as store_slug, c.slug as category_slug
    FROM user_alerts a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN stores s ON a.store_id = s.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.is_active = true AND u.is_active = true
  `);

  let sent = 0;

  for (const deal of deals.rows) {
    for (const alert of alerts.rows) {
      if (!dealMatchesAlert(deal, alert)) continue;

      // Dedup: no more than once per deal per user per day
      const alreadySent = await query(`
        SELECT id FROM notifications
        WHERE user_id = $1 AND deal_id = $2 AND sent_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `, [alert.user_id, deal.id]);
      if (alreadySent.rows[0]) continue;

      // Email
      if (alert.notify_email) {
        const ok = await sendEmailAlert(alert.email, deal);
        if (ok) {
          await query(`
            INSERT INTO notifications (user_id, deal_id, alert_id, channel, status, message_body)
            VALUES ($1, $2, $3, 'email', 'sent', $4)
          `, [alert.user_id, deal.id, alert.id, `Score ${deal.opportunity_score}: ${deal.product_name}`]);
          sent++;
        }
      }

      // WhatsApp — Elite plan only
      const canWhatsApp = alert.notify_whatsapp && alert.whatsapp_number &&
        (alert.plan === 'elite' || process.env.NODE_ENV === 'development');
      if (canWhatsApp) {
        const ok = await sendWhatsAppAlert(alert.whatsapp_number, deal);
        if (ok) {
          await query(`
            INSERT INTO notifications (user_id, deal_id, alert_id, channel, status)
            VALUES ($1, $2, $3, 'whatsapp', 'sent')
          `, [alert.user_id, deal.id, alert.id]);
        }
      }
    }
  }

  // Also check watchlist matches
  await processWatchlistAlerts(deals.rows);

  logger.info(`✅ ${sent} notifications sent`);
  return sent;
}

async function processWatchlistAlerts(deals) {
  try {
    const watchItems = await query(`
      SELECT w.*, u.email, u.plan, u.preferences->>'whatsapp_number' as whatsapp_number
      FROM watchlist_items w
      JOIN users u ON w.user_id = u.id
      WHERE w.is_active = true AND u.is_active = true
    `);

    for (const deal of deals) {
      for (const item of watchItems.rows) {
        if (deal.discount_percent < (item.min_discount || 20)) continue;

        let matches = false;
        if (item.type === 'brand' && deal.brand && deal.brand.toLowerCase() === item.value.toLowerCase()) matches = true;
        else if (item.type === 'upc' && deal.upc === item.value) matches = true;
        else if (item.type === 'keyword' && (deal.product_name || '').toLowerCase().includes(item.value.toLowerCase())) matches = true;

        if (!matches) continue;

        // Check dedup
        const sent = await query(
          `SELECT id FROM notifications WHERE user_id = $1 AND deal_id = $2 AND sent_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
          [item.user_id, deal.id]
        );
        if (sent.rows[0]) continue;

        if (item.notify_email) await sendEmailAlert(item.email, deal);
        if (item.notify_whatsapp && item.whatsapp_number) await sendWhatsAppAlert(item.whatsapp_number, deal);
      }
    }
  } catch (err) {
    logger.error('Watchlist alert error:', err.message);
  }
}

function dealMatchesAlert(deal, alert) {
  if (alert.store_slug && alert.store_slug !== deal.store_slug) return false;
  if (alert.category_slug && alert.category_slug !== deal.category_slug) return false;
  if (alert.product_keyword) {
    const kw = alert.product_keyword.toLowerCase();
    if (!(deal.product_name || '').toLowerCase().includes(kw)) return false;
  }
  if (deal.discount_percent < (alert.min_discount_percent || 0)) return false;
  if (alert.min_profit > 0 && (deal.estimated_profit || 0) < alert.min_profit) return false;
  if (alert.min_score > 0 && deal.opportunity_score < alert.min_score) return false;
  return true;
}

module.exports = { sendEmailAlert, sendWhatsAppAlert, processAlerts, buildEmailHTML, buildWhatsAppMessage };

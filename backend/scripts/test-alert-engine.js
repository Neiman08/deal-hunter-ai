/**
 * test-alert-engine.js
 *
 * Dry-run simulation of the alert engine — no emails sent, no DB writes.
 * Uses the same logic as processAlerts() but prints what WOULD be sent.
 *
 * Usage:
 *   node scripts/test-alert-engine.js            # last 35 min deals, real DB
 *   node scripts/test-alert-engine.js --hours 24 # look back 24 hours
 *   node scripts/test-alert-engine.js --inject    # inject a fake deal to force match
 */

require('dotenv').config();

const argv = process.argv.slice(2);
const HOURS  = parseInt((argv[argv.indexOf('--hours') + 1]) || '35', 10) || 35;
const INJECT = argv.includes('--inject');
const IS_MIN = HOURS < 1;  // sub-hour fallback (treat as minutes)

console.log('\n' + '═'.repeat(65));
console.log('ALERT ENGINE DRY-RUN TEST');
console.log(`  Look-back  : ${HOURS} ${IS_MIN ? 'minutes' : 'hours'}`);
console.log(`  SMTP       : ${process.env.SMTP_USER ? process.env.SMTP_USER : '(not set — demo mode)'}`);
console.log(`  Twilio     : ${process.env.TWILIO_ACCOUNT_SID ? 'configured' : '(not set — demo mode)'}`);
console.log('═'.repeat(65) + '\n');

const { query } = require('../src/config/database');

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

async function run() {
  const interval = `${HOURS} hours`;

  // ── 1. Fetch recent deals ─────────────────────────────────────────────────
  const dealsRes = await query(`
    SELECT d.*, p.name as product_name, s.name as store_name, s.slug as store_slug,
      c.slug as category_slug
    FROM deals d
    JOIN products p ON d.product_id = p.id
    JOIN stores s ON d.store_id = s.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE d.detected_at > NOW() - INTERVAL '${interval}'
      AND d.is_active = true
      AND d.opportunity_score >= 70
      AND (d.is_error_price IS NOT TRUE)
    ORDER BY d.opportunity_score DESC
    LIMIT 50
  `);

  let deals = dealsRes.rows;

  if (INJECT && deals.length === 0) {
    console.log('[INJECT] No real deals found — injecting fake deal to test matching logic\n');
    deals = [{
      id: 999999,
      product_name: '[FAKE] Sony WH-1000XM5 Headphones',
      store_name: 'Best Buy',
      store_slug: 'best-buy',
      category_slug: 'electronics',
      deal_price: 149.99,
      regular_price: 399.99,
      discount_percent: 62,
      opportunity_score: 85,
      estimated_profit: 120,
      roi_percent: 80,
      detected_at: new Date(),
      is_error_price: false,
    }];
  }

  console.log(`[1] Deals eligible for alerts: ${deals.length}`);
  if (!deals.length) {
    console.log('    → No deals to alert on (try --hours 24 or --inject)\n');
    process.exit(0);
  }

  for (const d of deals) {
    console.log(`    • [${d.opportunity_score}] ${(d.product_name || '').slice(0, 50)} | $${d.deal_price} | ${d.store_slug}`);
  }

  // ── 2. Fetch active user alerts ───────────────────────────────────────────
  const alertsRes = await query(`
    SELECT a.*, u.email, u.plan, u.name as user_name,
      u.preferences->>'whatsapp_number' as whatsapp_number,
      s.slug as store_slug, c.slug as category_slug
    FROM user_alerts a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN stores s ON a.store_id = s.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.is_active = true AND u.is_active = true
  `);

  console.log(`\n[2] Active user alerts: ${alertsRes.rows.length}`);
  for (const a of alertsRes.rows) {
    console.log(`    • ${a.user_name} (${a.email}) | store=${a.store_slug || 'any'} | min_score=${a.min_score || 0} | email=${a.notify_email} | wa=${a.notify_whatsapp}`);
  }

  // ── 3. Simulate matching ──────────────────────────────────────────────────
  console.log('\n[3] Match simulation:');
  let matchCount = 0;

  for (const deal of deals) {
    for (const alert of alertsRes.rows) {
      if (!dealMatchesAlert(deal, alert)) continue;

      const alreadySent = await query(
        `SELECT id FROM notifications WHERE user_id=$1 AND deal_id=$2 AND sent_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
        [alert.user_id, deal.id]
      );
      if (alreadySent.rows[0]) {
        console.log(`    ⏭️  SKIP (already sent): ${alert.user_name} ← deal ${deal.id}`);
        continue;
      }

      matchCount++;
      console.log(`\n    ✅ MATCH #${matchCount}`);
      console.log(`       User  : ${alert.user_name} (${alert.email})`);
      console.log(`       Deal  : ${(deal.product_name || '').slice(0, 50)}`);
      console.log(`       Score : ${deal.opportunity_score}  Discount: ${Math.round(deal.discount_percent)}%`);
      if (alert.notify_email) {
        console.log(`       EMAIL : Would send to ${alert.email}`);
        console.log(`               Subject: 🚨 ${deal.opportunity_score}/100 Score — ${(deal.product_name || '').slice(0, 40)}`);
      }
      if (alert.notify_whatsapp && alert.whatsapp_number) {
        console.log(`       WHATSAPP: Would send to ${alert.whatsapp_number}`);
      }
    }
  }

  // ── 4. Watchlist check ────────────────────────────────────────────────────
  const wlRes = await query(`
    SELECT w.*, u.email, u.plan, u.preferences->>'whatsapp_number' as whatsapp_number
    FROM watchlist_items w
    JOIN users u ON w.user_id = u.id
    WHERE w.is_active = true AND u.is_active = true
  `);

  console.log(`\n[4] Active watchlist items: ${wlRes.rows.length}`);
  let wlMatchCount = 0;

  for (const deal of deals) {
    for (const item of wlRes.rows) {
      if (deal.discount_percent < (item.min_discount || 20)) continue;
      let matches = false;
      if (item.type === 'brand' && deal.brand && deal.brand.toLowerCase() === item.value.toLowerCase()) matches = true;
      else if (item.type === 'upc' && deal.upc === item.value) matches = true;
      else if (item.type === 'keyword' && (deal.product_name || '').toLowerCase().includes(item.value.toLowerCase())) matches = true;
      if (!matches) continue;

      wlMatchCount++;
      console.log(`    ✅ WATCHLIST MATCH: ${item.type}="${item.value}" → ${(deal.product_name || '').slice(0, 40)}`);
      console.log(`       Email: ${item.email}`);
    }
  }

  if (!wlMatchCount) console.log('    (no watchlist matches)');

  // ── 5. Summary ────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(65));
  console.log('SUMMARY');
  console.log(`  Deals eligible   : ${deals.length}`);
  console.log(`  Alert matches    : ${matchCount}`);
  console.log(`  Watchlist matches: ${wlMatchCount}`);
  console.log(`  Email channel    : ${process.env.SMTP_USER ? 'LIVE' : 'DEMO MODE (no SMTP)'}`);
  console.log(`  WhatsApp channel : ${process.env.TWILIO_ACCOUNT_SID ? 'LIVE' : 'DEMO MODE (no Twilio)'}`);
  if (!process.env.SMTP_USER) {
    console.log('\n  To activate email: add SMTP_HOST, SMTP_USER, SMTP_PASS to .env');
    console.log('  Gmail: use App Password (2FA required) at myaccount.google.com/apppasswords');
  }
  console.log('─'.repeat(65) + '\n');

  process.exit(0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

/**
 * Liquidation Detector — Real clearance/markdown identification
 *
 * Detects:
 *  - CLEARANCE (bright orange/yellow tags, end-of-life items)
 *  - ROLLBACK (Walmart's price reduction program)
 *  - MANAGER SPECIAL (store-manager discretionary discounts)
 *  - MARKDOWN (Home Depot's automatic markdown cycle)
 *  - END OF SEASON (seasonal clearance)
 *  - DISCONTINUED (product being phased out)
 *  - PRICE ERROR (genuine pricing mistake)
 *  - OPEN BOX (damaged/returned items)
 */

const { query } = require('../config/database');
const logger = require('../utils/logger');

// ─── Tag signatures — text patterns found in product pages ───────────────────
const LIQUIDATION_PATTERNS = [
  // Clearance
  { type: 'CLEARANCE', patterns: ['clearance', 'clearance item', 'final clearance', 'store clearance'], priority: 10, color: '#ff4400', badge: '🔴 CLEARANCE' },
  // Rollback (Walmart-specific)
  { type: 'ROLLBACK', patterns: ['rollback', 'everyday low price rollback', 'price rollback'], priority: 8, color: '#0071CE', badge: '🔵 ROLLBACK' },
  // Manager Special
  { type: 'MANAGER_SPECIAL', patterns: ['manager special', "manager's special", 'manager markdown', 'store manager special'], priority: 9, color: '#ff6600', badge: '🟠 MANAGER SPECIAL' },
  // Markdown
  { type: 'MARKDOWN', patterns: ['markdown', 'final markdown', 'price markdown', 'reduced for clearance'], priority: 7, color: '#fbbf24', badge: '🟡 MARKDOWN' },
  // End of Season
  { type: 'END_OF_SEASON', patterns: ['end of season', 'seasonal clearance', 'end of line', 'season closeout', 'closeout'], priority: 6, color: '#a78bfa', badge: '🟣 END OF SEASON' },
  // Discontinued
  { type: 'DISCONTINUED', patterns: ['discontinued', 'being discontinued', 'no longer available', 'limited availability'], priority: 7, color: '#6b7280', badge: '⚫ DISCONTINUED' },
  // Open Box
  { type: 'OPEN_BOX', patterns: ['open box', 'open-box', 'display model', 'floor model', 'refurbished'], priority: 5, color: '#0891b2', badge: '📦 OPEN BOX' },
];

// ─── Price drop thresholds that trigger different alert levels ───────────────
const PRICE_DROP_THRESHOLDS = {
  ERROR_PRICE: 70,       // 70%+ drop = likely a pricing error
  DEEP_CLEARANCE: 60,    // 60-69% = deep clearance
  CLEARANCE: 40,         // 40-59% = clearance
  MARKDOWN: 25,          // 25-39% = markdown
  ROLLBACK: 15,          // 15-24% = rollback/small reduction
};

/**
 * Detect liquidation type from product data and page content
 */
function detectLiquidationType(product, priceData, pageContent = '') {
  const contentLower = (pageContent + ' ' + (product.name || '') + ' ' + (product.description || '')).toLowerCase();
  const discountPct = priceData.discountPercent || 0;

  // Check explicit tag patterns first
  for (const tag of LIQUIDATION_PATTERNS) {
    if (tag.patterns.some(p => contentLower.includes(p))) {
      return {
        type: tag.type,
        badge: tag.badge,
        color: tag.color,
        priority: tag.priority,
        confidence: 'HIGH',
        detected_via: 'tag_pattern',
      };
    }
  }

  // Detect from price drop magnitude
  if (discountPct >= PRICE_DROP_THRESHOLDS.ERROR_PRICE) {
    return {
      type: 'PRICE_ERROR',
      badge: '⚠️ PRICE ERROR',
      color: '#ff0000',
      priority: 10,
      confidence: 'MEDIUM',
      detected_via: 'price_analysis',
      note: `${discountPct.toFixed(0)}% drop may be pricing mistake`,
    };
  }

  if (discountPct >= PRICE_DROP_THRESHOLDS.DEEP_CLEARANCE) {
    return {
      type: 'CLEARANCE',
      badge: '🔴 DEEP CLEARANCE',
      color: '#ff4400',
      priority: 9,
      confidence: 'MEDIUM',
      detected_via: 'price_analysis',
    };
  }

  if (discountPct >= PRICE_DROP_THRESHOLDS.CLEARANCE) {
    return {
      type: 'CLEARANCE',
      badge: '🔴 CLEARANCE',
      color: '#ff6600',
      priority: 7,
      confidence: 'LOW',
      detected_via: 'price_analysis',
    };
  }

  if (discountPct >= PRICE_DROP_THRESHOLDS.MARKDOWN) {
    return {
      type: 'MARKDOWN',
      badge: '🟡 MARKDOWN',
      color: '#fbbf24',
      priority: 5,
      confidence: 'LOW',
      detected_via: 'price_analysis',
    };
  }

  return null; // Not a liquidation
}

/**
 * Detect from price velocity — how fast price has been falling
 */
function detectFromPriceHistory(priceHistory) {
  if (!priceHistory || priceHistory.length < 3) return null;

  const prices = priceHistory.map(p => parseFloat(p.current_price));
  const latest = prices[prices.length - 1];
  const oldest = prices[0];
  const totalDrop = ((oldest - latest) / oldest) * 100;

  // Calculate velocity (drop per week)
  const daySpan = Math.max(1, (priceHistory.length - 1) * 5); // approx
  const weeklyDropRate = (totalDrop / daySpan) * 7;

  if (totalDrop >= 50 && weeklyDropRate >= 10) {
    return {
      type: 'AGGRESSIVE_MARKDOWN',
      badge: '📉 AGGRESSIVE MARKDOWN',
      color: '#ff4400',
      priority: 8,
      confidence: 'HIGH',
      detected_via: 'price_velocity',
      note: `${totalDrop.toFixed(0)}% drop over ${daySpan} days (${weeklyDropRate.toFixed(0)}%/wk)`,
    };
  }

  if (totalDrop >= 30 && weeklyDropRate >= 5) {
    return {
      type: 'MARKDOWN',
      badge: '🟡 PRICE TREND DOWN',
      color: '#fbbf24',
      priority: 6,
      confidence: 'MEDIUM',
      detected_via: 'price_velocity',
      note: `Dropping ${weeklyDropRate.toFixed(0)}% per week`,
    };
  }

  return null;
}

/**
 * Identify stock-based liquidation signals
 */
function detectFromStock(stockQty, prevStockQty) {
  if (stockQty === null) return null;

  // Very low stock after normal levels = being cleared out
  if (stockQty <= 2 && prevStockQty > 10) {
    return {
      type: 'STOCK_CLEARANCE',
      badge: '🚨 LAST UNITS',
      color: '#ff4400',
      priority: 8,
      confidence: 'HIGH',
      detected_via: 'stock_analysis',
      note: `Only ${stockQty} units remaining`,
    };
  }

  if (stockQty <= 5) {
    return {
      type: 'LOW_STOCK',
      badge: '⚡ LOW STOCK',
      color: '#fbbf24',
      priority: 6,
      confidence: 'MEDIUM',
      detected_via: 'stock_analysis',
    };
  }

  return null;
}

/**
 * Full liquidation analysis — combines all signals
 */
async function analyzeLiquidation(productId, currentPrice, regularPrice, stockQty, pageContent = '') {
  const discountPercent = regularPrice > 0
    ? ((regularPrice - currentPrice) / regularPrice) * 100
    : 0;

  // Get price history
  const histRes = await query(`
    SELECT current_price, stock_quantity, recorded_at
    FROM prices
    WHERE product_id = $1
    ORDER BY recorded_at DESC
    LIMIT 20
  `, [productId]);
  const history = histRes.rows;

  // Get product info
  const prodRes = await query('SELECT name, description, brand FROM products WHERE id = $1', [productId]);
  const product = prodRes.rows[0] || {};

  // Run detectors
  const signals = [
    detectLiquidationType(product, { discountPercent }, pageContent),
    detectFromPriceHistory(history),
    detectFromStock(stockQty, history[1]?.stock_quantity),
  ].filter(Boolean);

  if (!signals.length) return null;

  // Return highest priority signal
  signals.sort((a, b) => b.priority - a.priority);
  const primary = signals[0];

  // Save to deal record
  return {
    ...primary,
    all_signals: signals,
    discount_percent: discountPercent,
    stock_qty: stockQty,
  };
}

/**
 * Batch-process all active deals to detect liquidation types
 */
async function processLiquidationBatch() {
  logger.info('🔍 Running liquidation detection batch...');

  const deals = await query(`
    SELECT d.id, d.product_id, d.deal_price, d.regular_price,
      d.discount_percent, d.stock_quantity, p.name
    FROM deals d
    JOIN products p ON d.product_id = p.id
    WHERE d.is_active = true
      AND (d.liquidation_type IS NULL OR d.last_seen_at > NOW() - INTERVAL '30 minutes')
    LIMIT 100
  `);

  let tagged = 0;
  for (const deal of deals.rows) {
    const result = await analyzeLiquidation(
      deal.product_id,
      deal.deal_price,
      deal.regular_price,
      deal.stock_quantity
    );

    if (result) {
      await query(`
        UPDATE deals SET
          liquidation_type = $1,
          liquidation_badge = $2,
          liquidation_color = $3,
          liquidation_confidence = $4
        WHERE id = $5
      `, [result.type, result.badge, result.color, result.confidence, deal.id]);
      tagged++;
    }
  }

  logger.info(`✅ Liquidation detection: ${tagged}/${deals.rows.length} deals tagged`);
  return tagged;
}

module.exports = {
  analyzeLiquidation,
  detectLiquidationType,
  detectFromPriceHistory,
  detectFromStock,
  processLiquidationBatch,
  LIQUIDATION_PATTERNS,
  PRICE_DROP_THRESHOLDS,
};

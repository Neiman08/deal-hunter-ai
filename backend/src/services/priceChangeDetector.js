/**
 * Price Change Detector — Phase 9
 *
 * After each price scan, detects:
 *  - Significant markdowns (>30% drop)
 *  - Penny items ($0.01 price)
 *  - Extreme clearance (>80% off original)
 *  - Rollbacks (price increases after markdown)
 *
 * Records all changes in price_changes and markdown_history tables.
 * This data feeds the future penny-item / hidden-deal detection system.
 */

const { query } = require('../config/database');
const logger    = require('../utils/logger');

const PENNY_THRESHOLD  = 0.01;
const MARKDOWN_MINIMUM = 0.30; // 30% drop to qualify as markdown

/**
 * Called after a price record is inserted.
 * Compares new price to previous recorded price and logs changes.
 */
async function detectPriceChange(productId, storeId, newPrice, regularPrice) {
  try {
    // Get last known price
    const prev = await query(`
      SELECT current_price, recorded_at FROM prices
      WHERE product_id = $1
      ORDER BY recorded_at DESC
      OFFSET 1 LIMIT 1
    `, [productId]);

    if (!prev.rows.length) return; // First price record — nothing to compare

    const oldPrice = parseFloat(prev.rows[0].current_price);
    if (oldPrice <= 0 || Math.abs(oldPrice - newPrice) < 0.01) return; // No change

    const changePct = (newPrice - oldPrice) / oldPrice;
    let changeType = 'unknown';

    if (newPrice <= PENNY_THRESHOLD) {
      changeType = 'penny';
    } else if (changePct <= -MARKDOWN_MINIMUM) {
      changeType = 'markdown';
      // Check if this is extreme clearance
      if (regularPrice > 0 && newPrice / regularPrice <= 0.20) changeType = 'clearance';
    } else if (changePct > 0) {
      changeType = 'rollback';
    }

    // Insert into price_changes
    await query(`
      INSERT INTO price_changes (product_id, store_id, old_price, new_price, change_type)
      VALUES ($1, $2, $3, $4, $5)
    `, [productId, storeId, oldPrice, newPrice, changeType]);

    // For markdowns and clearance, update markdown_history
    if (changeType === 'markdown' || changeType === 'clearance') {
      await query(`
        INSERT INTO markdown_history (product_id, store_id, markdown_date, original_price, marked_down_price)
        VALUES ($1, $2, CURRENT_DATE, $3, $4)
        ON CONFLICT (product_id, store_id, markdown_date) DO UPDATE
          SET marked_down_price = EXCLUDED.marked_down_price,
              original_price    = GREATEST(markdown_history.original_price, EXCLUDED.original_price),
              is_final_markdown = (EXCLUDED.marked_down_price / EXCLUDED.original_price) < 0.15
      `, [productId, storeId, regularPrice || oldPrice, newPrice]);
    }

    // For penny items — record as hidden deal
    if (changeType === 'penny') {
      await query(`
        INSERT INTO hidden_deals (product_id, store_id, deal_type, listed_price, actual_price, confidence, evidence)
        VALUES ($1, $2, 'penny_item', $3, $4, 'HIGH', $5)
        ON CONFLICT DO NOTHING
      `, [
        productId, storeId, regularPrice || oldPrice, newPrice,
        JSON.stringify({ old_price: oldPrice, new_price: newPrice, detected_at: new Date() }),
      ]);
      logger.info(`[PriceDetector] 🪙 PENNY ITEM detected! Product ${productId}: $${oldPrice} → $${newPrice}`);
    } else if (changeType === 'markdown' || changeType === 'clearance') {
      const dropPct = Math.round(Math.abs(changePct) * 100);
      logger.info(`[PriceDetector] 📉 ${changeType.toUpperCase()} -${dropPct}% | Product ${productId}: $${oldPrice} → $${newPrice}`);
    }

  } catch (e) {
    logger.error(`[PriceDetector] Error for product ${productId}: ${e.message}`);
  }
}

/**
 * Batch scan for recent price changes — run after each discovery cycle.
 * Finds products where last two price records differ significantly.
 */
async function detectRecentChanges() {
  logger.info('[PriceDetector] Scanning for recent price changes...');

  const res = await query(`
    WITH latest AS (
      SELECT DISTINCT ON (product_id)
        product_id, current_price AS new_price, recorded_at
      FROM prices
      ORDER BY product_id, recorded_at DESC
    ),
    previous AS (
      SELECT DISTINCT ON (product_id)
        product_id, current_price AS old_price
      FROM prices
      WHERE recorded_at < NOW() - INTERVAL '5 minutes'
      ORDER BY product_id, recorded_at DESC
    )
    SELECT
      l.product_id, p2.store_id, l.new_price, prev.old_price,
      prev.old_price AS regular_price
    FROM latest l
    JOIN previous prev ON prev.product_id = l.product_id
    JOIN products p2   ON p2.id = l.product_id
    WHERE ABS(l.new_price - prev.old_price) / GREATEST(prev.old_price, 0.01) > 0.30
      AND prev.old_price > 0
      AND l.recorded_at > NOW() - INTERVAL '2 hours'
    LIMIT 100
  `);

  let markdowns = 0, pennies = 0;
  for (const row of res.rows) {
    const { product_id, store_id, new_price, old_price, regular_price } = row;
    if (parseFloat(new_price) <= PENNY_THRESHOLD) pennies++;
    else markdowns++;
    await detectPriceChange(product_id, store_id, parseFloat(new_price), parseFloat(regular_price));
  }

  logger.info(`[PriceDetector] Found: ${markdowns} markdowns, ${pennies} penny items`);
  return { markdowns, pennies, total: res.rows.length };
}

module.exports = { detectPriceChange, detectRecentChanges };

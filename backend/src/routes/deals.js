const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requirePlan } = require('../middleware/auth');

const BASE_DEAL_QUERY = `
  SELECT
    d.id, d.regular_price, d.deal_price, d.discount_percent, d.savings_amount,
    d.resale_price_amazon, d.resale_price_ebay, d.resale_price_facebook,
    d.amazon_fees, d.ebay_fees, d.shipping_estimate,
    d.estimated_profit, d.roi_percent, d.demand_level, d.estimated_days_to_sell,
    d.opportunity_score, d.opportunity_label, d.score_breakdown,
    d.stock_quantity, d.is_error_price, d.price_trend,
    d.detected_at, d.last_seen_at,
    p.id as product_id, p.name, p.brand, p.upc, p.sku, p.image_url, p.product_url,
    s.name as store_name, s.slug as store_slug, s.color as store_color,
    c.name as category_name, c.slug as category_slug,
    sl.address as store_address, sl.city, sl.state, sl.latitude, sl.longitude
  FROM deals d
  JOIN products p ON d.product_id = p.id
  JOIN stores s ON d.store_id = s.id
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN store_locations sl ON d.store_location_id = sl.id
  WHERE d.is_active = true
`;

// GET /deals
router.get('/', async (req, res) => {
  try {
    const {
      store, category, min_discount = 15, max_discount,
      min_score, min_profit, brand, keyword,
      sort = 'score', limit = 20, offset = 0,
      is_error_price,
    } = req.query;

    let conditions = [
      'd.is_active = true',
      `d.discount_percent >= $1`
    ];
    let params = [parseFloat(min_discount)];
    let p = 2;

    if (store) { conditions.push(`s.slug = $${p++}`); params.push(store); }
    if (category) { conditions.push(`c.slug = $${p++}`); params.push(category); }
    if (max_discount) { conditions.push(`d.discount_percent <= $${p++}`); params.push(parseFloat(max_discount)); }
    if (min_score) { conditions.push(`d.opportunity_score >= $${p++}`); params.push(parseInt(min_score)); }
    if (min_profit) { conditions.push(`d.estimated_profit >= $${p++}`); params.push(parseFloat(min_profit)); }
    if (brand) { conditions.push(`LOWER(p.brand) LIKE $${p++}`); params.push(`%${brand.toLowerCase()}%`); }
    if (keyword) {
      conditions.push(`(LOWER(p.name) LIKE $${p} OR LOWER(p.brand) LIKE $${p})`);
      params.push(`%${keyword.toLowerCase()}%`);
      p++;
    }
    if (is_error_price === 'true') { conditions.push(`d.is_error_price = true`); }

    const sortMap = {
      score: 'd.opportunity_score DESC, d.discount_percent DESC',
      discount: 'd.discount_percent DESC',
      profit: 'd.estimated_profit DESC NULLS LAST',
      roi: 'd.roi_percent DESC NULLS LAST',
      newest: 'd.detected_at DESC',
      price_asc: 'd.deal_price ASC',
      price_desc: 'd.deal_price DESC',
    };
    const orderBy = sortMap[sort] || sortMap.score;

    const where = conditions.join(' AND ');
    const q = `
      SELECT
        d.id, d.regular_price, d.deal_price, d.discount_percent, d.savings_amount,
        d.estimated_profit, d.roi_percent, d.demand_level,
        d.opportunity_score, d.opportunity_label, d.stock_quantity, d.is_error_price,
        d.resale_price_amazon, d.resale_price_ebay, d.resale_price_facebook,
        d.detected_at, d.last_seen_at,
        p.name, p.brand, p.image_url, p.product_url,
        s.name as store_name, s.slug as store_slug, s.color as store_color,
        c.name as category_name
      FROM deals d
      JOIN products p ON d.product_id = p.id
      JOIN stores s ON d.store_id = s.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${p} OFFSET $${p + 1}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const [dealsRes, countRes] = await Promise.all([
      query(q, params),
      query(`SELECT COUNT(*) FROM deals d JOIN products p ON d.product_id = p.id JOIN stores s ON d.store_id = s.id LEFT JOIN categories c ON p.category_id = c.id WHERE ${where}`, params.slice(0, -2)),
    ]);

    res.json({
      deals: dealsRes.rows,
      total: parseInt(countRes.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch deals' });
  }
});

// GET /deals/stats/trends — 7-day daily deal counts
router.get('/stats/trends', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        TO_CHAR(day::date, 'Dy') AS day,
        COALESCE(deal_count, 0)  AS deals,
        COALESCE(profit_sum, 0)  AS profit
      FROM generate_series(
        (NOW() - INTERVAL '6 days')::date,
        NOW()::date,
        '1 day'::interval
      ) AS day
      LEFT JOIN (
        SELECT
          detected_at::date AS d,
          COUNT(*)           AS deal_count,
          ROUND(SUM(COALESCE(estimated_profit,0))::numeric, 0) AS profit_sum
        FROM deals
        WHERE is_active = true
          AND detected_at >= NOW() - INTERVAL '7 days'
        GROUP BY detected_at::date
      ) sub ON sub.d = day::date
      ORDER BY day ASC
    `);
    res.json({ trends: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// GET /deals/stats
router.get('/stats', async (req, res) => {
  try {
    const [main, stores, cats] = await Promise.all([
      query(`
        SELECT
          COUNT(*) FILTER (WHERE is_active) as total_deals,
          COUNT(*) FILTER (WHERE is_active AND detected_at > NOW() - INTERVAL '24 hours') as new_today,
          COUNT(*) FILTER (WHERE is_active AND detected_at > NOW() - INTERVAL '1 hour') as new_this_hour,
          COUNT(*) FILTER (WHERE is_active AND is_error_price) as error_prices,
          COALESCE(SUM(estimated_profit) FILTER (WHERE is_active AND estimated_profit > 0), 0) as total_potential_profit,
          COALESCE(AVG(discount_percent) FILTER (WHERE is_active), 0) as avg_discount,
          COALESCE(AVG(opportunity_score) FILTER (WHERE is_active), 0) as avg_score,
          COUNT(*) FILTER (WHERE is_active AND opportunity_score >= 90) as excellent_deals,
          COUNT(*) FILTER (WHERE is_active AND opportunity_score >= 71) as good_deals
        FROM deals
      `),
      query(`
        SELECT s.name, s.slug, s.color, COUNT(DISTINCT d.id) as deal_count,
          ROUND(AVG(d.opportunity_score)::numeric, 1) as avg_score
        FROM deals d JOIN stores s ON d.store_id = s.id
        WHERE d.is_active = true
        GROUP BY s.id, s.name, s.slug, s.color
        ORDER BY deal_count DESC
      `),
      query(`
        SELECT c.name, c.slug, COUNT(d.id) as deal_count,
          ROUND(AVG(d.estimated_profit), 2) as avg_profit
        FROM deals d JOIN products p ON d.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE d.is_active = true AND c.name IS NOT NULL
        GROUP BY c.id, c.name, c.slug
        ORDER BY deal_count DESC LIMIT 6
      `),
    ]);

    res.json({
      ...main.rows[0],
      top_stores: stores.rows,
      top_categories: cats.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /deals/:id — full detail with price history
router.get('/:id', async (req, res) => {
  try {
    const dealRes = await query(`${BASE_DEAL_QUERY} AND d.id = $1`, [req.params.id]);
    if (!dealRes.rows.length) return res.status(404).json({ error: 'Deal not found' });

    const deal = dealRes.rows[0];

    const historyRes = await query(`
      SELECT current_price, regular_price, discount_percent, recorded_at, source
      FROM prices
      WHERE product_id = $1
      ORDER BY recorded_at ASC
      LIMIT 90
    `, [deal.product_id]);

    const priceHistory = historyRes.rows;
    const prices = priceHistory.map(r => parseFloat(r.current_price));
    const historyStats = prices.length > 0 ? {
      all_time_min: Math.min(...prices),
      all_time_max: Math.max(...prices),
      avg_price: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
      data_points: prices.length,
    } : null;

    res.json({ deal, price_history: priceHistory, history_stats: historyStats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch deal' });
  }
});

// POST /deals/:id/save
router.post('/:id/save', authenticate, async (req, res) => {
  try {
    await query(`
      INSERT INTO saved_deals (user_id, deal_id) VALUES ($1, $2)
      ON CONFLICT (user_id, deal_id) DO NOTHING
    `, [req.user.id, req.params.id]);

    await query(`INSERT INTO user_activity (user_id, action, deal_id) VALUES ($1, 'save_deal', $2)`, [req.user.id, req.params.id]);
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save deal' });
  }
});

// DELETE /deals/:id/save
router.delete('/:id/save', authenticate, async (req, res) => {
  try {
    await query(`DELETE FROM saved_deals WHERE user_id = $1 AND deal_id = $2`, [req.user.id, req.params.id]);
    res.json({ saved: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsave deal' });
  }
});

// GET /deals/user/saved
router.get('/user/saved', authenticate, async (req, res) => {
  try {
    const r = await query(`
      SELECT d.*, p.name, p.brand, p.image_url, s.name as store_name, s.slug as store_slug,
        sd.saved_at, sd.purchased, sd.actual_profit
      FROM saved_deals sd
      JOIN deals d ON sd.deal_id = d.id
      JOIN products p ON d.product_id = p.id
      JOIN stores s ON d.store_id = s.id
      WHERE sd.user_id = $1
      ORDER BY sd.saved_at DESC LIMIT 50
    `, [req.user.id]);
    res.json({ deals: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved deals' });
  }
});

module.exports = router;

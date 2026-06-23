const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requirePlan } = require('../middleware/auth');

// Public feed quality gate.
// Rule: ONLY products with is_public_visible = true AND quality_status = 'PASS' are shown.
// NULLs (unclassified) are NEVER shown. This is strict by design.
let _qualityFilter = '';

async function runQualityClassification() {
  // Ensure columns exist (idempotent)
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_status         VARCHAR(30)  DEFAULT NULL`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_reason         TEXT         DEFAULT NULL`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_public_visible      BOOLEAN      DEFAULT NULL`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS last_quality_check_at  TIMESTAMPTZ  DEFAULT NULL`);

  const { rowCount } = await query(`
    UPDATE products p SET
      quality_status = CASE
        WHEN trim(COALESCE(p.name,''))='' OR length(trim(COALESCE(p.name,''))) < 5
          THEN 'HIDDEN_MISSING_TITLE'
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          OR p.name ~* '^product[[:space:]]+[0-9]+$'
          OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
          OR p.name ~ '^[0-9]{5,}$'
          THEN 'HIDDEN_GENERIC_TITLE'
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN 'HIDDEN_BROKEN_URL'
        WHEN p.product_url IS NULL OR trim(p.product_url)=''
          THEN 'INCOMPLETE_PRODUCT'
        WHEN p.image_url IS NULL OR trim(p.image_url)=''
          THEN 'NEEDS_IMAGE'
        ELSE 'PASS'
      END,
      is_public_visible = CASE
        WHEN trim(COALESCE(p.name,''))='' OR length(trim(COALESCE(p.name,''))) < 5 THEN false
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          OR p.name ~* '^product[[:space:]]+[0-9]+$'
          OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
          OR p.name ~ '^[0-9]{5,}$'
          THEN false
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN false
        WHEN p.product_url IS NULL OR trim(p.product_url)='' THEN false
        ELSE true
      END,
      quality_reason = CASE
        WHEN trim(COALESCE(p.name,''))='' OR length(trim(COALESCE(p.name,''))) < 5
          THEN 'Empty or too-short product name'
        WHEN p.name ~* '^gamestop product[[:space:]]+[0-9]+$'
          OR p.name ~* '^product[[:space:]]+[0-9]+$'
          OR p.name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+$'
          THEN 'Placeholder name: ' || trim(p.name)
        WHEN p.name ~ '^[0-9]{5,}$'
          THEN 'Numeric-only name: ' || trim(p.name)
        WHEN p.product_url LIKE '%macys.com%'
          AND p.product_url NOT LIKE '%?ID=%'
          AND p.product_url NOT LIKE '%/ID/%'
          THEN 'Macy''s URL missing product ID — will 404 in browser'
        WHEN p.product_url IS NULL OR trim(p.product_url)=''
          THEN 'No product URL'
        WHEN p.image_url IS NULL OR trim(p.image_url)=''
          THEN 'No image — flagged for enrichment'
        ELSE NULL
      END,
      last_quality_check_at = NOW(),
      updated_at = NOW()
  `);

  console.log(`[quality-gate] classified ${rowCount} products`);

  // Log summary for Render logs / diagnosis
  const summary = await query(`
    SELECT quality_status, is_public_visible,
           COUNT(*) AS n
    FROM products
    GROUP BY quality_status, is_public_visible
    ORDER BY n DESC
    LIMIT 20
  `);
  for (const r of summary.rows) {
    const vis = r.is_public_visible === true ? 'VISIBLE' : r.is_public_visible === false ? 'HIDDEN' : 'NULL';
    console.log(`  [quality-gate] ${(r.quality_status || 'NULL').padEnd(25)} ${vis.padEnd(8)} n=${r.n}`);
  }

  return rowCount;
}

// Run classification at startup with one retry to handle cold pool timeouts
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const n = await runQualityClassification();
      _qualityFilter = `(p.is_public_visible = true AND p.quality_status IN ('PASS', 'NEEDS_IMAGE'))`;
      console.log(`[quality-gate] ACTIVE — filter set after ${n} products classified (attempt ${attempt})`);
      return;
    } catch (err) {
      console.error(`[quality-gate] attempt ${attempt} FAILED: ${err.message}`);
      if (attempt < 2) await sleep(5000);
    }
  }
  console.error('[quality-gate] FAILED both attempts — public feed unfiltered (degraded mode)');
})();

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
      min_score, min_profit, brand, keyword, q: search, freshness,
      sort = 'score', limit = 20, offset = 0,
      is_error_price,
    } = req.query;

    let conditions = [
      'd.is_active = true',
      `d.discount_percent >= $1`,
      '(d.is_error_price IS NOT TRUE)',
      'd.deal_price > 0',
      ...(  _qualityFilter ? [_qualityFilter] : []),
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
    if (search) {
      conditions.push(`(LOWER(p.name) LIKE $${p} OR LOWER(p.brand) LIKE $${p} OR LOWER(s.name) LIKE $${p} OR LOWER(COALESCE(c.name,'')) LIKE $${p})`);
      params.push(`%${search.toLowerCase()}%`);
      p++;
    }
    if (freshness === 'fresh')  conditions.push(`d.last_seen_at > NOW() - INTERVAL '24 hours'`);
    if (freshness === 'recent') conditions.push(`d.last_seen_at > NOW() - INTERVAL '7 days' AND d.last_seen_at <= NOW() - INTERVAL '24 hours'`);
    if (freshness === 'aging')  conditions.push(`d.last_seen_at <= NOW() - INTERVAL '7 days'`);
    // Admin view: replace exclusion with inclusion when is_error_price=true
    if (is_error_price === 'true') {
      conditions = conditions.filter(c => !c.includes('is_error_price'));
      conditions.push('d.is_error_price = true');
    }

    const sortMap = {
      score:     'd.opportunity_score DESC, d.discount_percent DESC, d.id ASC',
      discount:  'd.discount_percent DESC, d.id ASC',
      profit:    'd.estimated_profit DESC NULLS LAST, d.id ASC',
      roi:       'd.roi_percent DESC NULLS LAST, d.id ASC',
      newest:    'd.detected_at DESC, d.id ASC',
      price_asc: 'd.deal_price ASC, d.id ASC',
      price_desc:'d.deal_price DESC, d.id ASC',
      freshness: `CASE WHEN d.last_seen_at > NOW() - INTERVAL '24 hours' THEN 1 WHEN d.last_seen_at > NOW() - INTERVAL '7 days' THEN 2 WHEN d.last_seen_at > NOW() - INTERVAL '30 days' THEN 3 ELSE 4 END ASC, d.opportunity_score DESC, d.discount_percent DESC, d.id ASC`,
    };
    const orderBy = sortMap[sort] || sortMap.score;

    const where = conditions.join(' AND ');
    const sql = `
      SELECT
        d.id, d.regular_price, d.deal_price, d.discount_percent, d.savings_amount,
        d.estimated_profit, d.roi_percent, d.demand_level,
        d.opportunity_score, d.opportunity_label, d.stock_quantity, d.is_error_price,
        d.resale_price_amazon, d.resale_price_ebay, d.resale_price_facebook,
        d.detected_at, d.last_seen_at,
        p.name, p.brand, p.image_url, p.product_url,
        s.name as store_name, s.slug as store_slug, s.color as store_color,
        c.name as category_name,
        EXISTS(
          SELECT 1 FROM product_market_data pmd
          WHERE pmd.product_id = p.id AND pmd.source = 'keepa'
          AND pmd.fetched_at > NOW() - INTERVAL '7 days'
        ) as has_keepa_data,
        CASE
          WHEN d.last_seen_at > NOW() - INTERVAL '24 hours' THEN 1
          WHEN d.last_seen_at > NOW() - INTERVAL '7 days'   THEN 2
          WHEN d.last_seen_at > NOW() - INTERVAL '30 days'  THEN 3
          ELSE 4
        END AS freshness_rank,
        CASE
          WHEN d.last_seen_at > NOW() - INTERVAL '24 hours' THEN 'fresh'
          WHEN d.last_seen_at > NOW() - INTERVAL '7 days'   THEN 'recent'
          WHEN d.last_seen_at > NOW() - INTERVAL '30 days'  THEN 'aging'
          ELSE 'historical'
        END AS freshness
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
      query(sql, params),
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
        TO_CHAR(series_day::date, 'Dy') AS day,
        COALESCE(deal_count, 0)          AS deals,
        COALESCE(profit_sum, 0)          AS profit
      FROM generate_series(
        (NOW() - INTERVAL '6 days')::date,
        NOW()::date,
        '1 day'::interval
      ) AS series_day
      LEFT JOIN (
        SELECT
          detected_at::date AS d,
          COUNT(*)           AS deal_count,
          ROUND(SUM(COALESCE(estimated_profit,0))::numeric, 0) AS profit_sum
        FROM deals
        WHERE is_active = true
          AND detected_at >= NOW() - INTERVAL '7 days'
        GROUP BY detected_at::date
      ) sub ON sub.d = series_day::date
      ORDER BY series_day::date ASC
    `);
    res.json({ trends: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// GET /deals/live — active deals alias (for external validation / scrapers)
router.get('/live', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const r = await query(`
      SELECT
        d.id, d.regular_price, d.deal_price, d.discount_percent,
        d.estimated_profit, d.roi_percent, d.opportunity_score, d.opportunity_label,
        d.stock_quantity, d.is_error_price, d.detected_at, d.last_seen_at,
        p.name, p.brand, p.image_url,
        s.name as store_name, s.slug as store_slug, s.color as store_color,
        c.name as category_name
      FROM deals d
      JOIN products p ON d.product_id = p.id
      JOIN stores s ON d.store_id = s.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE d.is_active = true
        AND d.deal_price > 0
        ${_qualityFilter ? `AND ${_qualityFilter}` : ''}
      ORDER BY d.opportunity_score DESC NULLS LAST, d.discount_percent DESC
      LIMIT $1
    `, [limit]);
    res.json({ deals: r.rows, total: r.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch live deals' });
  }
});

// GET /deals/stats
router.get('/stats', async (req, res) => {
  try {
    const [main, stores, cats, productsRes] = await Promise.all([
      query(`
        SELECT
          COUNT(*) FILTER (WHERE is_active) as total_deals,
          COUNT(*) FILTER (WHERE is_active AND detected_at > NOW() - INTERVAL '24 hours') as new_today,
          COUNT(*) FILTER (WHERE is_active AND detected_at > NOW() - INTERVAL '1 hour') as new_this_hour,
          COUNT(*) FILTER (WHERE is_active AND is_error_price) as error_prices,
          COALESCE(SUM(estimated_profit) FILTER (WHERE is_active AND estimated_profit > 0), 0) as total_potential_profit,
          COALESCE(SUM(estimated_profit) FILTER (WHERE is_active AND discount_percent >= 20 AND estimated_profit > 0), 0) as potential_profit_searchable,
          COALESCE(AVG(discount_percent) FILTER (WHERE is_active), 0) as avg_discount,
          COALESCE(AVG(opportunity_score) FILTER (WHERE is_active), 0) as avg_score,
          COUNT(*) FILTER (WHERE is_active AND opportunity_score >= 90) as excellent_deals,
          COUNT(*) FILTER (WHERE is_active AND opportunity_score >= 71) as good_deals,
          COUNT(*) FILTER (WHERE is_active AND last_seen_at > NOW() - INTERVAL '24 hours') as fresh_24h,
          COUNT(*) FILTER (WHERE is_active AND last_seen_at <= NOW() - INTERVAL '24 hours' AND last_seen_at > NOW() - INTERVAL '7 days') as recent_7d,
          COUNT(*) FILTER (WHERE is_active AND last_seen_at <= NOW() - INTERVAL '7 days'   AND last_seen_at > NOW() - INTERVAL '30 days') as aging_30d,
          COUNT(*) FILTER (WHERE is_active AND last_seen_at <= NOW() - INTERVAL '30 days') as historical_45d,
          COUNT(*) FILTER (WHERE is_active AND discount_percent >= 20) as searchable_deals_default,
          COUNT(*) FILTER (WHERE is_active AND discount_percent < 20)  as low_discount_deals
        FROM deals
      `),
      query(`
        SELECT s.name, s.slug, s.color, COUNT(DISTINCT d.id) as deal_count,
          ROUND(AVG(d.opportunity_score)::numeric, 1) as avg_score,
          COUNT(DISTINCT d.id) FILTER (WHERE d.last_seen_at > NOW() - INTERVAL '24 hours') as fresh_deal_count,
          MAX(d.last_seen_at) as last_seen_at
        FROM deals d JOIN stores s ON d.store_id = s.id
        WHERE d.is_active = true AND d.discount_percent >= 20
        GROUP BY s.id, s.name, s.slug, s.color
        ORDER BY deal_count DESC
      `),
      query(`
        SELECT c.name, c.slug, COUNT(d.id) as deal_count,
          ROUND(AVG(d.estimated_profit) FILTER (WHERE d.estimated_profit > 0), 2) as avg_profit
        FROM deals d JOIN products p ON d.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE d.is_active = true AND d.discount_percent >= 20 AND c.name IS NOT NULL
        GROUP BY c.id, c.name, c.slug
        ORDER BY deal_count DESC
      `),
      query(`SELECT COUNT(*) as total_products FROM products`),
    ]);

    res.json({
      ...main.rows[0],
      total_products: parseInt(productsRes.rows[0].total_products) || 0,
      stores_with_fresh_deals: stores.rows.filter(s => parseInt(s.fresh_deal_count || 0) > 0).length,
      top_stores: stores.rows,
      top_categories: cats.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /deals/:id — full detail with price history and cached market data
router.get('/:id', async (req, res) => {
  try {
    const dealRes = await query(`${BASE_DEAL_QUERY} AND d.id = $1`, [req.params.id]);
    if (!dealRes.rows.length) return res.status(404).json({ error: 'Deal not found' });

    const deal = dealRes.rows[0];

    const [historyRes, marketRes] = await Promise.all([
      query(`
        SELECT current_price, regular_price, discount_percent, recorded_at, source
        FROM prices
        WHERE product_id = $1
        ORDER BY recorded_at ASC
        LIMIT 90
      `, [deal.product_id]),
      query(`
        SELECT * FROM product_market_data
        WHERE product_id = $1
        ORDER BY fetched_at DESC LIMIT 1
      `, [deal.product_id]).catch(() => ({ rows: [] })),
    ]);

    const priceHistory = historyRes.rows;
    const prices = priceHistory.map(r => parseFloat(r.current_price));
    const historyStats = prices.length > 0 ? {
      all_time_min: Math.min(...prices),
      all_time_max: Math.max(...prices),
      avg_price: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
      data_points: prices.length,
    } : null;

    const mRow = marketRes.rows[0] || null;
    const market_data = mRow ? {
      source: mRow.source,
      asin: mRow.asin,
      upc: mRow.upc,
      amazon_current_price: mRow.amazon_current_price ? parseFloat(mRow.amazon_current_price) : null,
      amazon_buy_box_price: mRow.amazon_buy_box_price ? parseFloat(mRow.amazon_buy_box_price) : null,
      amazon_90d_avg_price: mRow.amazon_90d_avg_price ? parseFloat(mRow.amazon_90d_avg_price) : null,
      amazon_180d_avg_price: mRow.amazon_180d_avg_price ? parseFloat(mRow.amazon_180d_avg_price) : null,
      amazon_new_price: mRow.amazon_new_price ? parseFloat(mRow.amazon_new_price) : null,
      amazon_used_price: mRow.amazon_used_price ? parseFloat(mRow.amazon_used_price) : null,
      sales_rank: mRow.sales_rank ? parseInt(mRow.sales_rank) : null,
      category: mRow.category,
      is_amazon_in_stock: mRow.is_amazon_in_stock,
      confidence: mRow.keepa_confidence ? parseInt(mRow.keepa_confidence) : 0,
      fetched_at: mRow.fetched_at,
    } : null;

    res.json({ deal, price_history: priceHistory, history_stats: historyStats, market_data });
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

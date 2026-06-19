const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { lookupByCode, getCachedMarketData, isEnabled } = require('../services/external/keepaService');
const { evaluate } = require('../services/scannerEvaluation');
const logger = require('../utils/logger');

// GET /api/scanner/lookup/:code
router.get('/lookup/:code', authenticate, async (req, res) => {
  const code = (req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    // Search internal DB by UPC, SKU, or ASIN
    const internalRes = await query(`
      SELECT
        p.id as product_id, p.upc, p.sku, p.name, p.brand, p.image_url, p.product_url,
        s.name as store_name, s.slug as store_slug, s.color as store_color,
        d.id as deal_id, d.deal_price, d.regular_price, d.discount_percent,
        d.opportunity_score, d.opportunity_label, d.estimated_profit, d.roi_percent,
        d.resale_price_amazon, d.stock_quantity, d.is_error_price, d.detected_at
      FROM products p
      JOIN stores s ON p.store_id = s.id
      LEFT JOIN deals d ON d.product_id = p.id AND d.is_active = true
      WHERE p.upc = $1 OR LOWER(p.sku) = LOWER($1)
      ORDER BY d.opportunity_score DESC NULLS LAST
      LIMIT 10
    `, [code]);

    const foundInternal = internalRes.rows.length > 0;
    const product = foundInternal ? internalRes.rows[0] : null;
    const deals = foundInternal ? internalRes.rows.filter(r => r.deal_id) : [];

    // Check Keepa cache first; only call API if not cached
    let marketData = null;
    let keepaResult = null;

    if (product?.product_id) {
      marketData = await getCachedMarketData({ productId: product.product_id, upc: code });
    }
    if (!marketData) {
      marketData = await getCachedMarketData({ upc: code });
    }

    if (marketData) {
      logger.info(`[Scanner] cache hit for code ${code}`);
      // Derive effective price — use saved DB value, fall back to inline computation for pre-migration rows
      const md = marketData;
      const empRaw  = md.effective_market_price  ? parseFloat(md.effective_market_price)  : null;
      const empPrice = empRaw ?? (
        md.amazon_buy_box_price  ? parseFloat(md.amazon_buy_box_price)  :
        md.amazon_current_price  ? parseFloat(md.amazon_current_price)  :
        md.amazon_90d_avg_price  ? parseFloat(md.amazon_90d_avg_price)  :
        md.amazon_180d_avg_price ? parseFloat(md.amazon_180d_avg_price) : null
      );
      const empSource = md.effective_market_source || (
        md.amazon_buy_box_price  ? 'buy_box'         :
        md.amazon_current_price  ? 'amazon_current'  :
        md.amazon_90d_avg_price  ? 'amazon_90d_avg'  :
        md.amazon_180d_avg_price ? 'amazon_180d_avg' : 'none'
      );
      const empConf = md.pricing_confidence != null ? parseInt(md.pricing_confidence) :
        empSource === 'buy_box' ? 90 : empSource === 'amazon_current' ? 80 :
        empSource === 'amazon_90d_avg' ? 60 : empSource === 'amazon_180d_avg' ? 40 : 0;

      keepaResult = {
        configured: true,
        found: true,
        cached: true,
        source: 'keepa',
        asin: md.asin,
        upc: md.upc,
        title: md.title,
        brand: md.brand,
        image_url: md.image_url,
        amazon_current_price: md.amazon_current_price ? parseFloat(md.amazon_current_price) : null,
        amazon_buy_box_price: md.amazon_buy_box_price ? parseFloat(md.amazon_buy_box_price) : null,
        amazon_90d_avg_price: md.amazon_90d_avg_price ? parseFloat(md.amazon_90d_avg_price) : null,
        amazon_180d_avg_price: md.amazon_180d_avg_price ? parseFloat(md.amazon_180d_avg_price) : null,
        amazon_new_price: md.amazon_new_price ? parseFloat(md.amazon_new_price) : null,
        amazon_used_price: md.amazon_used_price ? parseFloat(md.amazon_used_price) : null,
        sales_rank: md.sales_rank ? parseInt(md.sales_rank) : null,
        category: md.category,
        is_amazon_in_stock: md.is_amazon_in_stock,
        offers_count: md.offers_count ? parseInt(md.offers_count) : null,
        confidence: md.keepa_confidence ? parseInt(md.keepa_confidence) : 0,
        effective_market_price: empPrice,
        effective_market_source: empSource,
        pricing_confidence: empConf,
        fetched_at: md.fetched_at,
      };
    } else if (isEnabled()) {
      // No cache — call Keepa API
      keepaResult = await lookupByCode(
        { upc: code },
        { productId: product?.product_id || null }
      );
    } else {
      keepaResult = { configured: false, error: 'Keepa API not configured' };
    }

    res.json({
      code,
      found_internal: foundInternal,
      product: product ? {
        product_id: product.product_id,
        upc: product.upc,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        image_url: product.image_url,
        product_url: product.product_url,
        store_name: product.store_name,
        store_slug: product.store_slug,
        store_color: product.store_color,
      } : null,
      deals: deals.map(d => ({
        deal_id: d.deal_id,
        deal_price: d.deal_price ? parseFloat(d.deal_price) : null,
        regular_price: d.regular_price ? parseFloat(d.regular_price) : null,
        discount_percent: d.discount_percent ? parseFloat(d.discount_percent) : null,
        opportunity_score: d.opportunity_score,
        opportunity_label: d.opportunity_label,
        estimated_profit: d.estimated_profit ? parseFloat(d.estimated_profit) : null,
        roi_percent: d.roi_percent ? parseFloat(d.roi_percent) : null,
        stock_quantity: d.stock_quantity,
        is_error_price: d.is_error_price,
      })),
      keepa: keepaResult,
      market_data: marketData || null,
      external_enabled: isEnabled(),
    });
  } catch (err) {
    logger.error(`[Scanner] lookup error for code=${code}: ${err.message}`);
    res.status(500).json({ error: 'Scanner lookup failed', details: err.message });
  }
});

// POST /api/scanner/evaluate
router.post('/evaluate', authenticate, async (req, res) => {
  const {
    code, product_id, title, brand,
    in_store_price,
    effective_market_price, effective_market_source, pricing_confidence,
    amazon_current_price, amazon_buy_box_price, amazon_90d_avg_price,
    sales_rank, confidence,
    ebay_avg_price, ebay_median_price, ebay_sold_count,
  } = req.body;

  if (!in_store_price) {
    return res.status(400).json({ error: 'in_store_price required' });
  }

  const result = evaluate({
    in_store_price,
    effective_market_price,
    effective_market_source,
    pricing_confidence,
    amazon_current_price,
    amazon_buy_box_price,
    amazon_90d_avg_price,
    sales_rank,
    confidence,
    ebay_avg_price,
    ebay_median_price,
    ebay_sold_count,
  });

  res.json({
    code,
    product_id,
    title,
    brand,
    ...result,
  });
});

// POST /api/scanner/history
router.post('/history', authenticate, async (req, res) => {
  const {
    code, code_type = 'upc', product_id, found_internal,
    in_store_price, store_slug, evaluation, keepa_asin, keepa_confidence,
  } = req.body;

  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    const r = await query(`
      INSERT INTO scanner_history (user_id, code, code_type, product_id, found_internal, in_store_price, store_slug, evaluation, keepa_asin, keepa_confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      req.user.id, code, code_type,
      product_id || null, found_internal || false,
      in_store_price ? parseFloat(in_store_price) : null,
      store_slug || null,
      evaluation ? JSON.stringify(evaluation) : '{}',
      keepa_asin || null,
      keepa_confidence ? parseInt(keepa_confidence) : null,
    ]);
    res.json({ saved: true, id: r.rows[0].id });
  } catch (err) {
    logger.error(`[Scanner] history save error: ${err.message}`);
    res.status(500).json({ error: 'Failed to save scan history' });
  }
});

// GET /api/scanner/history
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const r = await query(`
      SELECT sh.*, p.name as product_name, p.image_url
      FROM scanner_history sh
      LEFT JOIN products p ON sh.product_id = p.id
      WHERE sh.user_id = $1
      ORDER BY sh.scanned_at DESC
      LIMIT $2
    `, [req.user.id, limit]);
    res.json({ history: r.rows, total: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scan history' });
  }
});

module.exports = router;

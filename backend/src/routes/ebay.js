const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ebayService = require('../services/external/ebayService');
const { query } = require('../config/database');

// GET /api/ebay/status
router.get('/status', async (req, res) => {
  try {
    const enabled = ebayService.isEnabled();
    const cacheRes = await query(`
      SELECT COUNT(*) as total,
        MAX(fetched_at) as last_fetch
      FROM ebay_market_data
    `).catch(() => ({ rows: [{ total: 0, last_fetch: null }] }));

    res.json({
      enabled,
      configured: enabled,
      cache_hours: parseFloat(process.env.EBAY_CACHE_HOURS || '24'),
      products_with_ebay_data: parseInt(cacheRes.rows[0]?.total || 0),
      last_fetch_at: cacheRes.rows[0]?.last_fetch || null,
      env_vars_present: {
        EBAY_CLIENT_ID: !!process.env.EBAY_CLIENT_ID,
        EBAY_CLIENT_SECRET: !!process.env.EBAY_CLIENT_SECRET,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ebay/lookup/:code — look up by UPC; falls back to keyword if no UPC match
router.get('/lookup/:code', authenticate, async (req, res) => {
  const { code } = req.params;
  const { product_id, keyword } = req.query;

  try {
    // Try UPC first
    const upcResult = await ebayService.lookupByUpc(code, {
      productId: product_id || null,
    });

    if (upcResult.found) return res.json(upcResult);

    // Fallback to keyword if provided
    if (keyword) {
      const kwResult = await ebayService.lookupByKeyword(keyword, code, {
        productId: product_id || null,
      });
      return res.json(kwResult);
    }

    return res.json(upcResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ebay/lookup — lookup by keyword (for scanner or deal detail)
router.post('/lookup', authenticate, async (req, res) => {
  const { upc, keyword, product_id } = req.body;

  if (!upc && !keyword) {
    return res.status(400).json({ error: 'upc or keyword required' });
  }

  try {
    let result;
    if (upc) {
      result = await ebayService.lookupByUpc(upc, { productId: product_id });
      if (!result.found && keyword) {
        result = await ebayService.lookupByKeyword(keyword, upc, { productId: product_id });
      }
    } else {
      result = await ebayService.lookupByKeyword(keyword, null, { productId: product_id });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ebay/product/:productId — fetch cached eBay data for a specific product
router.get('/product/:productId', authenticate, async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM ebay_market_data WHERE product_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
      [req.params.productId]
    ).catch(() => ({ rows: [] }));

    const row = r.rows[0];
    if (!row) return res.json({ found: false });

    res.json({
      found: true,
      source: 'ebay',
      upc: row.upc,
      avg_sold_price: row.avg_sold_price ? parseFloat(row.avg_sold_price) : null,
      min_price: row.min_price ? parseFloat(row.min_price) : null,
      max_price: row.max_price ? parseFloat(row.max_price) : null,
      median_price: row.median_price ? parseFloat(row.median_price) : null,
      sold_count: row.sold_count,
      active_listings: row.active_listings,
      top_item_url: row.top_item_url,
      fetched_at: row.fetched_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { scanSingleProduct, runScan } = require('../jobs/scanJob');
const logger = require('../utils/logger');

router.get('/status', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM scan_logs ORDER BY started_at DESC LIMIT 10
    `);
    res.json({ recent_scans: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildBestBuyInput(input) {
  if (!input) return null;

  if (input.startsWith('http')) return input;

  // Nuevo formato Best Buy: /product/.../JJGCQLKXL7
  if (/^[A-Z0-9]{6,20}$/i.test(input) && !/^\d+$/.test(input)) {
    return `https://www.bestbuy.com/search?search=${encodeURIComponent(input)}`;
  }

  // SKU numérico clásico
  if (/^\d{5,8}$/.test(input)) {
    return `https://www.bestbuy.com/site/searchpage.jsp?st=${input}`;
  }

  return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(input)}`;
}

function buildStoreUrl(storeSlug, input) {
  if (!input) return null;
  if (input.startsWith('http')) return input;

  if (storeSlug === 'best-buy') return buildBestBuyInput(input);
  if (storeSlug === 'walmart') return `https://www.walmart.com/search?q=${encodeURIComponent(input)}`;
  if (storeSlug === 'home-depot') return `https://www.homedepot.com/s/${encodeURIComponent(input)}`;
  if (storeSlug === 'target') return `https://www.target.com/s?searchTerm=${encodeURIComponent(input)}`;
  if (storeSlug === 'lowes') return `https://www.lowes.com/search?searchTerm=${encodeURIComponent(input)}`;
  if (storeSlug === 'macys')  return `https://www.macys.com/shop/featured/${encodeURIComponent(input)}`;

  return input;
}

async function handleSingleProductScan(req, res, storeSlug) {
  const rawInput = req.query.url || req.query.q || req.params.sku || req.params.upc || req.params.id;
  const url = buildStoreUrl(storeSlug, rawInput);

  if (!url) {
    return res.status(400).json({
      error: 'url, q, sku, upc or id required',
      examples: [
        `/api/scan/${storeSlug}?url=https://www.bestbuy.com/product/.../JJGCQLKXL7`,
        `/api/scan/${storeSlug}/6571385`,
        `/api/scan/${storeSlug}?q=JJGCQLKXL7`
      ]
    });
  }

  logger.info(`[Route] ${storeSlug} test | input: ${rawInput} | resolved: ${url} | user: ${req.user?.email}`);

  try {
    const t0 = Date.now();
    const result = await scanSingleProduct(storeSlug, url);
    const elapsed = Date.now() - t0;

    if (!result?.currentPrice) {
      return res.status(404).json({
        success: false,
        store: storeSlug,
        input: rawInput,
        url,
        elapsed_ms: elapsed,
        error: 'No price found',
        method_used: result?.source || 'unknown',
        result
      });
    }

    return res.json({
      success: true,
      store: storeSlug,
      input: rawInput,
      url,
      elapsed_ms: elapsed,
      method_used: result.source,
      product: result
    });

  } catch (err) {
    logger.error(`[Route] ${storeSlug} scan error: ${err.message}\n${err.stack}`);
    return res.status(500).json({
      success: false,
      store: storeSlug,
      input: rawInput,
      url,
      error: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  }
}

router.get('/walmart', authenticate, (req, res) => handleSingleProductScan(req, res, 'walmart'));
router.get('/best-buy', authenticate, (req, res) => handleSingleProductScan(req, res, 'best-buy'));
router.get('/home-depot', authenticate, (req, res) => handleSingleProductScan(req, res, 'home-depot'));
router.get('/target', authenticate, (req, res) => handleSingleProductScan(req, res, 'target'));
router.get('/lowes', authenticate, (req, res) => handleSingleProductScan(req, res, 'lowes'));
router.get('/macys', authenticate, (req, res) => handleSingleProductScan(req, res, 'macys'));

router.get('/walmart/:upc', authenticate, (req, res) => handleSingleProductScan(req, res, 'walmart'));
router.get('/best-buy/:sku', authenticate, (req, res) => handleSingleProductScan(req, res, 'best-buy'));
router.get('/best-buy/id/:id', authenticate, (req, res) => handleSingleProductScan(req, res, 'best-buy'));
router.get('/home-depot/:sku', authenticate, (req, res) => handleSingleProductScan(req, res, 'home-depot'));
router.get('/target/:id', authenticate, (req, res) => handleSingleProductScan(req, res, 'target'));
router.get('/lowes/:id', authenticate, (req, res) => handleSingleProductScan(req, res, 'lowes'));
router.get('/macys/:id', authenticate, (req, res) => handleSingleProductScan(req, res, 'macys'));

router.post('/run', authenticate, requireAdmin, async (req, res) => {
  const { store } = req.body;
  res.json({ message: `Scan queued: ${store || 'all stores'}`, queued: true });

  setImmediate(async () => {
    try {
      await runScan(store || null);
    } catch (err) {
      logger.error(`[Scan Manual] ${err.message}`);
    }
  });
});

module.exports = router;
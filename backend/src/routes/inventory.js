const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { fetchAndSaveInventory, getProductInventory } = require('../services/inventoryService');
const { query } = require('../config/database');

// GET /inventory/:productId — get inventory across store locations
router.get('/:productId', authenticate, async (req, res) => {
  try {
    // Try cache first
    let inventory = await getProductInventory(req.params.productId);

    // Fetch fresh if stale or empty
    if (!inventory.length) {
      const prod = await query(
        'SELECT p.*, s.slug FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = $1',
        [req.params.productId]
      );
      if (prod.rows[0]) {
        inventory = await fetchAndSaveInventory(req.params.productId, prod.rows[0].slug);
      }
    }

    // Aggregate totals
    const totalQty = inventory.reduce((s, i) => s + (i.quantity_on_hand || 0), 0);
    const inStockCount = inventory.filter(i => i.in_stock).length;
    const clearanceStores = inventory.filter(i => i.is_clearance);

    res.json({
      inventory,
      summary: {
        total_quantity: totalQty,
        stores_in_stock: inStockCount,
        stores_checked: inventory.length,
        clearance_available: clearanceStores.length > 0,
        clearance_stores: clearanceStores,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /inventory/refresh/:productId — force fresh fetch
router.post('/refresh/:productId', authenticate, async (req, res) => {
  try {
    const prod = await query(
      'SELECT p.*, s.slug FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = $1',
      [req.params.productId]
    );
    if (!prod.rows[0]) return res.status(404).json({ error: 'Product not found' });

    const inventory = await fetchAndSaveInventory(req.params.productId, prod.rows[0].slug);
    res.json({ inventory, refreshed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

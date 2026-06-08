require('dotenv').config({ path: '../.env' });
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding database v2...');

    // ── Stores ────────────────────────────────────────────────────────────────
    const stores = [
      { name: 'Walmart',        slug: 'walmart',        color: '#0071CE', website_url: 'https://walmart.com',         scraper_module: 'walmartScraper' },
      { name: 'Home Depot',     slug: 'home-depot',     color: '#F96302', website_url: 'https://homedepot.com',       scraper_module: 'homeDepotScraper' },
      { name: 'Target',         slug: 'target',         color: '#CC0000', website_url: 'https://target.com',          scraper_module: null },
      { name: 'Best Buy',       slug: 'best-buy',       color: '#003087', website_url: 'https://bestbuy.com',         scraper_module: 'scrapers/bestbuy' },
      { name: "Lowe's",         slug: 'lowes',          color: '#004990', website_url: 'https://lowes.com',           scraper_module: null },
      { name: "Macy's",         slug: 'macys',          color: '#E21A2C', website_url: 'https://macys.com',           scraper_module: 'scrapers/macys' },
      { name: 'GameStop',       slug: 'gamestop',       color: '#5D1DB6', website_url: 'https://www.gamestop.com',    scraper_module: null },
      { name: 'Office Depot',   slug: 'office-depot',   color: '#C8102E', website_url: 'https://www.officedepot.com', scraper_module: null },
      { name: 'Staples',        slug: 'staples',        color: '#CC0000', website_url: 'https://www.staples.com',     scraper_module: null },
      { name: "Kohl's",         slug: 'kohls',          color: '#CC0000', website_url: 'https://www.kohls.com',       scraper_module: null },
      { name: 'Nordstrom Rack', slug: 'nordstrom-rack', color: '#001E5B', website_url: 'https://www.nordstromrack.com', scraper_module: null },
      { name: 'TJ Maxx',        slug: 'tj-maxx',        color: '#E31837', website_url: 'https://www.tjmaxx.tjx.com', scraper_module: null },
      { name: 'Marshalls',      slug: 'marshalls',      color: '#C41230', website_url: 'https://www.marshalls.com',   scraper_module: null },
      { name: 'Burlington',     slug: 'burlington',     color: '#E31837', website_url: 'https://www.burlington.com',  scraper_module: null },
      { name: 'Costco',         slug: 'costco',         color: '#005DAA', website_url: 'https://www.costco.com',      scraper_module: null },
    ];
    const storeIds = {};
    for (const s of stores) {
      const r = await client.query(
        `INSERT INTO stores (name, slug, color, website_url, scraper_module, is_active)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [s.name, s.slug, s.color, s.website_url, s.scraper_module, true]
      );
      storeIds[s.slug] = r.rows[0].id;
    }
    console.log('✅ Stores seeded');

    // ── Categories ────────────────────────────────────────────────────────────
    const categories = [
      { name: 'Power Tools', slug: 'power-tools', icon: '🔧', demand_score: 0.90 },
      { name: 'Hand Tools', slug: 'hand-tools', icon: '🔨', demand_score: 0.70 },
      { name: 'Electronics', slug: 'electronics', icon: '📱', demand_score: 0.85 },
      { name: 'Appliances', slug: 'appliances', icon: '🏠', demand_score: 0.75 },
      { name: 'Kitchen', slug: 'kitchen', icon: '🍳', demand_score: 0.70 },
      { name: 'Outdoor', slug: 'outdoor', icon: '🌿', demand_score: 0.65 },
      { name: 'Automotive', slug: 'automotive', icon: '🚗', demand_score: 0.70 },
      { name: 'Toys', slug: 'toys', icon: '🧸', demand_score: 0.60 },
      { name: 'Clothing & Accessories', slug: 'clothing', icon: '👗', demand_score: 0.55 },
      { name: 'Home & Decor', slug: 'home-decor', icon: '🛋️', demand_score: 0.60 },
    ];
    const catIds = {};
    for (const c of categories) {
      const r = await client.query(
        `INSERT INTO categories (name, slug, icon, demand_score) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO UPDATE SET demand_score=EXCLUDED.demand_score RETURNING id`,
        [c.name, c.slug, c.icon, c.demand_score]
      );
      catIds[c.slug] = r.rows[0].id;
    }
    console.log('✅ Categories seeded');

    // ── Store Locations (Houston) ─────────────────────────────────────────────
    const locations = [
      { store: 'walmart', number: '5260', address: '5765 Westheimer Rd', city: 'Houston', state: 'TX', zip: '77057', lat: 29.7538, lng: -95.5012 },
      { store: 'walmart', number: '3442', address: '2727 Dunvale Rd', city: 'Houston', state: 'TX', zip: '77063', lat: 29.7352, lng: -95.5197 },
      { store: 'home-depot', number: '6906', address: '4343 Westheimer Rd', city: 'Houston', state: 'TX', zip: '77027', lat: 29.7504, lng: -95.4620 },
      { store: 'home-depot', number: '6562', address: '11200 Westheimer Rd', city: 'Houston', state: 'TX', zip: '77042', lat: 29.7492, lng: -95.5584 },
      { store: 'target', number: 'T-2103', address: '2600 S Shepherd Dr', city: 'Houston', state: 'TX', zip: '77098', lat: 29.7330, lng: -95.4022 },
    ];
    const locationIds = {};
    for (const l of locations) {
      const r = await client.query(
        `INSERT INTO store_locations (store_id, store_number, address, city, state, zip_code, latitude, longitude)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
        [storeIds[l.store], l.number, l.address, l.city, l.state, l.zip, l.lat, l.lng]
      );
      if (r.rows[0]) locationIds[`${l.store}-${l.number}`] = r.rows[0].id;
    }
    console.log('✅ Store locations seeded');

    // ── Products & Deals ──────────────────────────────────────────────────────
    const products = [
      { name: 'DeWalt 20V Max Drill/Driver Kit', brand: 'DeWalt', upc: '885911416443', sku: 'DCK240C2', store: 'home-depot', cat: 'power-tools', regular: 199, current: 49, img: 'https://images.homedepot-static.com/productImages/b7be01de-0bf2-4b08-9ec7-f1eef94cd2c2/svn/dewalt-combo-kits-dck240c2-64_1000.jpg' },
      { name: 'Milwaukee M18 FUEL 2-Tool Combo Kit', brand: 'Milwaukee', upc: '045242551118', sku: '2997-22', store: 'home-depot', cat: 'power-tools', regular: 349, current: 119, img: '' },
      { name: 'Dyson V11 Cordless Vacuum', brand: 'Dyson', upc: '885609012023', sku: 'V11-ABSOLUTE', store: 'walmart', cat: 'appliances', regular: 599, current: 149, img: '' },
      // REMOVED: sku 'OLED65C3PUA' is a manufacturer model number, not a Best Buy numeric SKU.
      // The correct BB numeric SKU for this TV is 6505727 (already seeded below).
      { name: 'KitchenAid 5 Qt Stand Mixer', brand: 'KitchenAid', upc: '071758440893', sku: 'KSM150PSER', store: 'target', cat: 'kitchen', regular: 449, current: 179, img: '' },
      { name: 'Makita 18V Circular Saw Kit', brand: 'Makita', upc: '088381217613', sku: 'XSS02T', store: 'home-depot', cat: 'power-tools', regular: 189, current: 79, img: '' },
      { name: 'iRobot Roomba i3+ Self-Emptying', brand: 'iRobot', upc: '885155017058', sku: 'i355020', store: 'walmart', cat: 'appliances', regular: 499, current: 149, img: '' },
      { name: 'Apple AirPods Pro 2nd Gen', brand: 'Apple', upc: '194253565055', sku: 'MTJV3LL/A', store: 'target', cat: 'electronics', regular: 249, current: 149, img: '' },
      // ── Macy's products (department store — clothing, home, kitchen) ─────────
      { name: "Le Creuset Signature 5-Qt Round Dutch Oven", brand: 'Le Creuset', upc: null, sku: 'LC-FO-5-RED', store: 'macys', cat: 'kitchen', regular: 420, current: 209, img: '', url: 'https://www.macys.com/shop/product/le-creuset-signature-enameled-cast-iron-5-qt-round-french-oven/ID/10296891' },
      { name: "KitchenAid Artisan 5-Qt Stand Mixer", brand: 'KitchenAid', upc: null, sku: 'KA-5QT-TILT', store: 'macys', cat: 'kitchen', regular: 499, current: 249, img: '', url: 'https://www.macys.com/shop/product/kitchenaid-artisan-5-quart-tilt-head-stand-mixer/ID/4126832' },
      { name: "Calvin Klein Leather Tote Bag", brand: 'Calvin Klein', upc: null, sku: 'CK-TOTE-BLK', store: 'macys', cat: 'clothing', regular: 198, current: 69, img: '', url: null },
      // ── Best Buy products (real SKUs, verified on bestbuy.com) ──────────────
      { name: 'LG 65" Class OLED evo C3 Series 4K TV', brand: 'LG', upc: null, sku: '6505727', bestbuy_sku: '6505727', store: 'best-buy', cat: 'electronics', regular: 1999, current: 799, img: '' },
      { name: 'Sony WH-1000XM5 Wireless Headphones', brand: 'Sony', upc: null, sku: '6396720', bestbuy_sku: '6396720', store: 'best-buy', cat: 'electronics', regular: 399, current: 279, img: '' },
      { name: 'Apple AirPods Pro (2nd Gen) USB-C', brand: 'Apple', upc: null, sku: '6447033', bestbuy_sku: '6447033', store: 'best-buy', cat: 'electronics', regular: 249, current: 189, img: '' },
      { name: 'Samsung 75" Class QLED 4K QN90C TV', brand: 'Samsung', upc: null, sku: '6570228', bestbuy_sku: '6570228', store: 'best-buy', cat: 'electronics', regular: 2799, current: 1099, img: '' },
      { name: 'iRobot Roomba i3+ EVO Self-Emptying Robot Vacuum', brand: 'iRobot', upc: null, sku: '6397375', bestbuy_sku: '6397375', store: 'best-buy', cat: 'appliances', regular: 599, current: 249, img: '' },
    ];

    for (const p of products) {
      // Insert product
      const prodRes = await client.query(
        `INSERT INTO products (name, brand, upc, sku, bestbuy_sku, bestbuy_sku_valid, store_id, category_id, image_url, product_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (sku, store_id) DO UPDATE SET
           name=EXCLUDED.name,
           bestbuy_sku=COALESCE(EXCLUDED.bestbuy_sku, products.bestbuy_sku),
           bestbuy_sku_valid=COALESCE(EXCLUDED.bestbuy_sku_valid, products.bestbuy_sku_valid),
           product_url=COALESCE(EXCLUDED.product_url, products.product_url)
         RETURNING id`,
        [p.name, p.brand, p.upc, p.sku, p.bestbuy_sku || null,
         p.bestbuy_sku ? /^\d{5,8}$/.test(p.bestbuy_sku) : null,
         storeIds[p.store], catIds[p.cat], p.img || null, p.url || null]
      );
      const productId = prodRes.rows[0].id;

      // Insert price history (5 data points showing decline)
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        const daysAgo = (steps - i) * 5;
        const priceFraction = 1 - ((1 - p.current / p.regular) * (i / (steps - 1)));
        const histPrice = Math.round(p.regular * priceFraction);
        await client.query(
          `INSERT INTO prices (product_id, regular_price, current_price, in_stock, recorded_at)
           VALUES ($1,$2,$3,true, NOW() - INTERVAL '${daysAgo} days')`,
          [productId, p.regular, histPrice]
        );
      }

      // Compute resale estimates
      const resaleMultipliers = { DeWalt: 0.82, Milwaukee: 0.85, Dyson: 0.80, LG: 0.75, KitchenAid: 0.78, Makita: 0.72, iRobot: 0.72, Apple: 0.88 };
      const mult = resaleMultipliers[p.brand] || 0.72;
      const amazon = Math.round(p.regular * mult);
      const ebay = Math.round(amazon * 0.92);
      const fb = Math.round(amazon * 0.85);
      const amazonFees = Math.round(amazon * 0.15);
      const ebayFees = Math.round(ebay * 0.13);
      const shipping = 12;
      const netProfit = Math.round(Math.max(amazon - amazonFees - shipping, ebay - ebayFees - shipping, fb) - p.current);
      const roi = Math.round((netProfit / p.current) * 100);
      const discountPct = Math.round(((p.regular - p.current) / p.regular) * 100);

      // Simple score calc
      let score = 0;
      if (discountPct >= 80) score += 50; else if (discountPct >= 60) score += 40; else if (discountPct >= 50) score += 30; else score += 15;
      if (netProfit >= 200) score += 20; else if (netProfit >= 100) score += 15; else if (netProfit >= 50) score += 10; else score += 5;
      score += 20; // history score
      score += 5; // stock score
      score = Math.min(100, score);

      const label = score >= 91 ? '🔥 Excelente' : score >= 71 ? '💎 Muy Buena' : '✅ Regular';
      const isError = discountPct >= 70;
      const breakdown = JSON.stringify({
        discountScore: Math.min(35, Math.round(discountPct * 0.45)),
        historyScore: 20,
        savingsScore: Math.min(15, Math.round((p.regular - p.current) / 20)),
        resaleScore: Math.min(20, Math.round(roi / 10)),
        stockScore: 4,
        demandScore: 5
      });

      await client.query(
        `INSERT INTO deals (product_id, store_id, regular_price, deal_price, discount_percent,
           resale_price_amazon, resale_price_ebay, resale_price_facebook,
           amazon_fees, ebay_fees, shipping_estimate,
           estimated_profit, roi_percent, demand_level, estimated_days_to_sell,
           opportunity_score, opportunity_label, score_breakdown,
           stock_quantity, is_error_price, is_active, expires_at, price_trend, data_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,NOW()+INTERVAL '48 hours',$21,$22)
         ON CONFLICT (product_id, store_id) DO UPDATE SET
           deal_price=EXCLUDED.deal_price, opportunity_score=EXCLUDED.opportunity_score,
           estimated_profit=EXCLUDED.estimated_profit, roi_percent=EXCLUDED.roi_percent`,
        [productId, storeIds[p.store], p.regular, p.current, discountPct,
          amazon, ebay, fb, amazonFees, ebayFees, shipping,
          netProfit, roi, roi >= 100 ? 'Very High' : 'High',
          roi >= 100 ? 3 : 7,
          score, label, breakdown, 3, isError, 'dropping_fast', 'demo']
      );
    }
    console.log('✅ Products and deals seeded with full resale data');

    // ── Users ─────────────────────────────────────────────────────────────────
    const adminHash = await bcrypt.hash('admin123', 10);
    const userHash = await bcrypt.hash('user123', 10);
    await client.query(
      `INSERT INTO users (email, password_hash, name, plan, is_admin, zip_code) VALUES
       ('admin@dealhunter.ai', $1, 'Admin User', 'elite', true, '77001'),
       ('demo@dealhunter.ai', $2, 'Demo User', 'pro', false, '77057')
       ON CONFLICT (email) DO NOTHING`,
      [adminHash, userHash]
    );
    console.log('✅ Users seeded');

    await client.query('COMMIT');
    console.log('\n🎉 Seed complete! 8 products, 8 deals with full resale data.');
    console.log('Admin: admin@dealhunter.ai / admin123');
    console.log('User:  demo@dealhunter.ai / user123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();

/**
 * Production migration: recover real names for GameStop placeholder products.
 * Sourced from Playwright enrichment run (local, 50 products, 100% success).
 * Matches by numeric product ID embedded in product_url — stable across
 * old-format (/products/XXXXX.html) and new Shopify slugs (.../XXXXX.html).
 * Only updates rows where name still looks like a placeholder.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { query } = require('../config/database');

const MAPPINGS = [
  { numId: '402415', name: 'Sony Disc Drive For PlayStation 5 Pro and Digital Edition Consoles', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-disc-drive-for-playstation-5-pro-and-digital-edition-consoles/402415.html' },
  { numId: '420432', name: 'Sony PlayStation 5 Console - Black', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-console---black/420432.html' },
  { numId: '398827', name: "PS5 Console: Sony PlayStation 5 Console (Marvel's Spider-Man 2 Bundle)", url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-console-marvels-spider-man-2-limited-edition-bundle/398827.html' },
  { numId: '232353', name: 'PS5 Console: Sony PlayStation 5 Console', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-console/232353.html' },
  { numId: '232355', name: 'Sony PlayStation 5 Digital Edition Console', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-digital-edition-console/232355.html' },
  { numId: '417018', name: 'Sony PlayStation 5 Pro Console with Disc Drive Installed', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-pro-console-with-disc-drive-installed/417018.html' },
  { numId: '416577', name: 'PS5 Pro: Sony PlayStation 5 Pro Console', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-pro-console/416577.html' },
  { numId: '402676', name: 'PS5 Slim Digital Edition Console', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-slim-console-digital-edition-1tb-ssd/402676.html' },
  { numId: '402678', name: 'PS5 Slim Console Disc Edition', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-5-slim-console-disc-edition/402678.html' },
  { numId: '421841', name: 'Sony PlayStation Portal Remote Player - Midnight Black', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-portal-remote-player-for-ps5-console---midnight-black/421841.html' },
  { numId: '402617', name: 'Sony PlayStation Portal Remote Player for PS5 Console', url: 'https://www.gamestop.com/consoles-hardware/playstation-5/consoles/products/sony-playstation-portal-remote-player-for-ps5-console/402617.html' },
  { numId: '119149', name: 'Microsoft Xbox One 500GB Console Black with 3.5mm Jack Controller', url: 'https://www.gamestop.com/consoles-hardware/xbox-one/consoles/products/microsoft-xbox-one-500gb-console-black-with-3.5mm-jack-controller/119149.html' },
  { numId: '131067', name: 'Microsoft Xbox One S 500GB Console White', url: 'https://www.gamestop.com/consoles-hardware/xbox-one/consoles/products/microsoft-xbox-one-s-500gb-console-white/131067.html' },
  { numId: '131070', name: 'Microsoft Xbox One S White 1TB', url: 'https://www.gamestop.com/consoles-hardware/xbox-one/consoles/products/microsoft-xbox-one-s-white-1tb/131070.html' },
  { numId: '158467', name: 'Microsoft Xbox One X 1TB Console Black', url: 'https://www.gamestop.com/consoles-hardware/xbox-one/consoles/products/microsoft-xbox-one-x-1tb-console-black/158467.html' },
  { numId: '415650', name: 'Microsoft Xbox Series S All Digital Console 1TB SSD - 120FPS - Robot White', url: 'https://www.gamestop.com/consoles-hardware/xbox-series-x%7Cs/consoles/products/microsoft-xbox-series-s-all-digital-console-1tb-ssd---120fps---robot-white/415650.html' },
  { numId: '229057', name: 'Xbox Series S Digital Edition Console', url: 'https://www.gamestop.com/consoles-hardware/xbox-series-x%7Cs/consoles/products/microsoft-xbox-series-s-all-digital-console-512gb-ssd---120fps---robot-white/229057.html' },
  { numId: '396869', name: 'Microsoft Xbox Series S Digital Console 1TB - Black', url: 'https://www.gamestop.com/consoles-hardware/xbox-series-x%7Cs/consoles/products/microsoft-xbox-series-s-digital-console-1tb---black/396869.html' },
  { numId: '415656', name: 'Microsoft Xbox Series X All Digital Console 1TB SSD - 4K Gaming - 120FPS - Robot White', url: 'https://www.gamestop.com/consoles-hardware/xbox-series-x%7Cs/consoles/products/microsoft-xbox-series-x-all-digital-console-1tb-ssd---4k-gaming---120fps---robot-white/415656.html' },
  { numId: '229056', name: 'Xbox Series X Console', url: 'https://www.gamestop.com/consoles-hardware/xbox-series-x%7Cs/consoles/products/microsoft-xbox-series-x-console-1tb-ssd---4k-gaming---120fps---carbon-black/229056.html' },
  { numId: '341516', name: 'GameStop Universal 6ft AC Power Cord for PlayStation 4, PlayStation 5, Xbox One, and Xbox Series X', url: 'https://www.gamestop.com/gaming-accessories/chargers-cables/playstation-5/products/gamestop-universal-6ft-ac-power-cord-for-playstation-4-playstation-5-xbox-one-and-xbox-series-x/341516.html' },
  { numId: '232516', name: 'Dualsense Charging Station - PS5 Charging Station', url: 'https://www.gamestop.com/gaming-accessories/chargers-cables/playstation-5/products/sony-playstation-5-dualsense-charging-station/232516.html' },
  { numId: '421837', name: 'Sony DualSense Edge Wireless Controller for PlayStation 5 - Midnight Black', url: 'https://www.gamestop.com/gaming-accessories/controllers/playstation-5/products/sony-dualsense-edge-wireless-controller-for-playstation-5---midnight-black/421837.html' },
  { numId: '339712', name: 'Sony DualSense Wireless Controller - Galactic Purple', url: 'https://www.gamestop.com/gaming-accessories/controllers/playstation-5/products/sony-dualsense-wireless-controller-for-playstation-5---galactic-purple/339712.html' },
  { numId: '357166', name: 'Sony DualSense Wireless Controller - Gray Camouflage', url: 'https://www.gamestop.com/gaming-accessories/controllers/playstation-5/products/sony-dualsense-wireless-controller-for-playstation-5---gray-camouflage/357166.html' },
  { numId: '349433', name: 'Sony DualSense Wireless Controller - Midnight Black', url: 'https://www.gamestop.com/gaming-accessories/controllers/playstation-5/products/sony-dualsense-wireless-controller-for-playstation-5---midnight-black/349433.html' },
  { numId: '335456', name: 'Sony DualSense Wireless Controller - Starlight Blue', url: 'https://www.gamestop.com/gaming-accessories/controllers/playstation-5/products/sony-dualsense-wireless-controller-for-playstation-5---starlight-blue/335456.html' },
  { numId: '232513', name: 'Sony DualSense Wireless Controller - White', url: 'https://www.gamestop.com/gaming-accessories/controllers/playstation-5/products/sony-dualsense-wireless-controller-for-playstation-5---white/232513.html' },
  { numId: '209549', name: 'Microsoft Xbox Elite Wireless Controller Series 2 - Black', url: 'https://www.gamestop.com/gaming-accessories/controllers/xbox-one/products/microsoft-xbox-elite-wireless-controller-series-2-xbox-series-x-s-xbox-one-and-windows-devices---black/209549.html' },
  { numId: '229092', name: 'Microsoft Xbox Wireless Controller - Carbon Black', url: 'https://www.gamestop.com/gaming-accessories/controllers/xbox-series-x%7Cs/products/microsoft-xbox-wireless-controller---carbon-black-for-xbox-series-x-s-xbox-one-and-windows-devices/229092.html' },
  { numId: '349321', name: 'Microsoft Xbox Wireless Controller - Pulse Red', url: 'https://www.gamestop.com/gaming-accessories/controllers/xbox-series-x%7Cs/products/microsoft-xbox-wireless-controller---pulse-red-for-xbox-series-x-s-xbox-one-and-windows-devices/349321.html' },
  { numId: '229093', name: 'Microsoft Xbox Wireless Controller - Robot White', url: 'https://www.gamestop.com/gaming-accessories/controllers/xbox-series-x%7Cs/products/microsoft-xbox-wireless-controller---robot-white-for-xbox-series-x-s-xbox-one-and-windows-devices/229093.html' },
  { numId: '349311', name: 'Microsoft Xbox Wireless Controller - Shock Blue', url: 'https://www.gamestop.com/gaming-accessories/controllers/xbox-series-x%7Cs/products/microsoft-xbox-wireless-controller---shock-blue-for-xbox-series-x-s-xbox-one-and-windows-devices/349311.html' },
  { numId: '532010', name: 'Xbox Gift Card $10 (Digital)', url: 'https://www.gamestop.com/gift-cards/gaming-gift-cards/products/10-xbox-gift-card-digital/532010.html' },
  { numId: '178308', name: '$25 PlayStation Store Gift Card (Digital Code)', url: 'https://www.gamestop.com/gift-cards/gaming-gift-cards/products/25-playstation-store-gift-card-digital-code/178308.html' },
  { numId: '154536', name: 'PlayStation Store Gift Card $10', url: 'https://www.gamestop.com/gift-cards/gaming-gift-cards/products/playstation-store-gift-card-10/154536.html' },
  { numId: '154533', name: 'PlayStation Store Gift Card $100', url: 'https://www.gamestop.com/gift-cards/gaming-gift-cards/products/playstation-store-gift-card-100/154533.html' },
  { numId: '154535', name: 'PlayStation Store Gift Card $50', url: 'https://www.gamestop.com/gift-cards/gaming-gift-cards/products/playstation-store-gift-card-50/154535.html' },
  { numId: '447524', name: 'Persona 4 Revival Collector\'s Edition - PlayStation 5', url: 'https://www.gamestop.com/video-games/playstation-5/products/persona-4-revival-collectors-edition---playstation-5/447524.html' },
  { numId: '447333', name: 'Tomb Raider: Legacy of Atlantis Collector\'s Edition - PlayStation 5', url: 'https://www.gamestop.com/video-games/playstation-5/products/tomb-raider-legacy-of-atlantis-collectors-edition---playstation-5/447333.html' },
  { numId: '445542', name: '007: First Light - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/007-first-light---xbox-series-x/445542.html' },
  { numId: '445521', name: "Assassin's Creed Black Flag Resynced - Xbox Series X", url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/assassins-creed-black-flag-resynced----xbox-series-x/445521.html' },
  { numId: '434674', name: 'Call of Duty: Black Ops 7 - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/call-of-duty-black-ops-7-cross-gen-bundle---xbox-series-x-xbox-one/434674.html' },
  { numId: '443001', name: 'Crimson Desert - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/crimson-desert---xbox-series-x/443001.html' },
  { numId: '322115', name: 'Elden Ring - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/elden-ring---xbox-series-x/322115.html' },
  { numId: '409454', name: 'Elden Ring Shadow of the Erdtree DLC - Xbox Series X/S', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/elden-ring-shadow-of-the-erdtree-dlc---xbox-series-x-s/409454.html' },
  { numId: '445043', name: 'Forza Horizon 6 - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/forza-horizon-6---xbox-series-x/445043.html' },
  { numId: '443773', name: 'Forza Horizon 6 Premium Upgrade DLC - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/forza-horizon-6-premium-upgrade-dlc---xbox-series-x/443773.html' },
  { numId: '447409', name: 'Halo: Campaign Evolved - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/halo-campaign-evolved---xbox-series-x/447409.html' },
  { numId: '442998', name: 'MLB The Show 26 - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/mlb-the-show-26---xbox-series-x/442998.html' },
  { numId: '435541', name: 'Monster Hunter Stories 3: Twisted Reflection - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/monster-hunter-stories-3-twisted-reflection---xbox-series-x/435541.html' },
  { numId: '429095', name: 'The Outer Worlds 2 - Xbox Series X', url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/the-outer-worlds-2-standard-edition---xbox-series-x/429095.html' },
  { numId: '447335', name: "Tomb Raider: Legacy of Atlantis Collector's Edition - Xbox Series X", url: 'https://www.gamestop.com/video-games/xbox-series-x%7Cs/products/tomb-raider-legacy-of-atlantis-collectors-edition---xbox-series-x/447335.html' },
];

async function migrate() {
  let updated = 0;
  let skipped = 0;

  for (const { numId, name, url } of MAPPINGS) {
    const result = await query(`
      UPDATE products
      SET
        name                  = $1,
        product_url           = $2,
        quality_status        = CASE WHEN image_url IS NOT NULL THEN 'PASS' ELSE 'NEEDS_IMAGE' END,
        is_public_visible     = true,
        quality_reason        = CASE WHEN image_url IS NOT NULL THEN NULL ELSE 'No image — flagged for enrichment' END,
        last_quality_check_at = NOW(),
        updated_at            = NOW()
      WHERE
        store_id = (SELECT id FROM stores WHERE slug = 'gamestop' LIMIT 1)
        AND product_url ~ $3
        AND (
          name ~* '^gamestop product[[:space:]]+[0-9]+'
          OR name ~* '^product[[:space:]]+[0-9]+'
          OR name ~* '^[a-z]{2,12}[[:space:]]+product[[:space:]]+[0-9]+'
        )
    `, [name, url, `/(${numId})(\\.html|/)?$`]);

    if (result.rowCount > 0) {
      console.log(`[gamestop-name-recovery] ✅ ${numId} → "${name}" (${result.rowCount} row)`);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`[gamestop-name-recovery] Done — updated: ${updated}, skipped (already fixed or not found): ${skipped}`);
}

migrate()
  .catch(err => { console.error('[gamestop-name-recovery] ERROR:', err.message); process.exit(1); })
  .then(() => process.exit(0));

/**
 * Best Buy State Inspector — versión enfocada
 *
 * Corre y pega el output aquí para que pueda reescribir el extractor.
 *
 * Uso:
 *   node scripts/inspect_bestbuy_state.js macbook
 *   node scripts/inspect_bestbuy_state.js "airpods 4"
 *   node scripts/inspect_bestbuy_state.js "samsung tv"
 */

require('dotenv').config();
const { newBestBuyContext, closeBrowser } = require('../src/services/browserEngine');
const fs   = require('fs');
const path = require('path');

const keyword = process.argv[2] || 'macbook';
const url     = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(keyword)}`;
const outDir  = path.resolve(__dirname, '../logs/inspect');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  console.log(`\nBB INSPECTOR | "${keyword}" | ${url}\n`);

  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Cerrar overlays
  for (const s of ['button[aria-label="Close"]', 'button[aria-label="close"]', '.c-close-button']) {
    await page.locator(s).first().click({ timeout: 1000 }).catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);

  // Scroll completo
  await page.evaluate(async () => {
    const h = Math.max(document.body.scrollHeight, 5000);
    for (let p = 0; p < h; p += 600) {
      window.scrollBy(0, 600);
      await new Promise(r => setTimeout(r, 350));
    }
  });
  await page.waitForTimeout(1200);

  console.log('title:', await page.title().catch(() => '?'));
  console.log('url:  ', page.url());

  // ── 1. Guardar __INITIAL_STATE__ completo en archivo ────────────────────────
  const stateStr = await page.evaluate(() => {
    try { return JSON.stringify(window.__INITIAL_STATE__ || null); }
    catch { return null; }
  });

  const stateFile = path.join(outDir, `state_${keyword.replace(/\s+/g,'_')}.json`);
  if (stateStr && stateStr !== 'null') {
    fs.writeFileSync(stateFile, stateStr);
    console.log(`\n✅ __INITIAL_STATE__ guardado (${(stateStr.length/1024).toFixed(0)}KB): ${stateFile}`);
  } else {
    console.log('\n❌ __INITIAL_STATE__ es null o undefined');
  }

  // ── 2. Buscar recursivamente arrays con datos de producto ────────────────────
  console.log('\n─── Arrays con sku/skuId/name/price (búsqueda recursiva): ───');
  const found = await page.evaluate(() => {
    const results = [];
    const walk = (obj, path, depth) => {
      if (depth > 7 || !obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
          const keys = Object.keys(v[0]);
          if (keys.some(k => ['sku','skuId','name','price','salePrice','currentPrice','priceInfo'].includes(k))) {
            results.push({ path: p, count: v.length, keys: keys.slice(0, 14) });
          }
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
          walk(v, p, depth + 1);
        }
      }
    };
    walk(window.__INITIAL_STATE__ || {}, '', 0);
    return results;
  });
  found.forEach(f => console.log(`  ${f.path} | count:${f.count} | keys:[${f.keys.join(', ')}]`));
  if (!found.length) console.log('  (none found)');

  // ── 3. DOM selectors con counts ─────────────────────────────────────────────
  console.log('\n─── DOM selectors (count > 0): ───');
  const domCounts = await page.evaluate(() => {
    const sels = [
      '.sku-item',
      '[data-sku-id]',
      'li[data-sku-id]',
      '[class*="ProductCard"]',
      '[class*="productCard"]',
      '[class*="product-card"]',
      '[class*="SearchResultCard"]',
      '[class*="gridItem"]',
      '[class*="grid-item"]',
      '[class*="ResultItem"]',
      '[class*="itemWrapper"]',
      '[class*="listItem"]',
      '[data-testid*="product"]',
      '[data-testid*="Product"]',
      '[data-component*="Product"]',
      '[class*="productLine"]',
      'article[class*="product"]',
    ];
    const out = {};
    for (const s of sels) {
      const n = document.querySelectorAll(s).length;
      if (n > 0) out[s] = n;
    }
    return out;
  });
  Object.entries(domCounts).forEach(([s, n]) => console.log(`  ${n.toString().padStart(3)}  ${s}`));
  if (!Object.keys(domCounts).length) console.log('  (none matched)');

  // ── 4. Links de producto ─────────────────────────────────────────────────────
  console.log('\n─── Product links (primeros 8): ───');
  const links = await page.evaluate(() => {
    const seen = new Set();
    const out  = [];
    const patterns = [
      'a[href*="skuId"]',
      'a[href*="/site/"][href$=".p"]',
      'a[href*="/product/"]',
      '.sku-item a',
      '[data-sku-id] a',
      '[class*="ProductCard"] a[href]',
    ];
    for (const pat of patterns) {
      for (const a of document.querySelectorAll(pat)) {
        const h = a.getAttribute('href') || '';
        if (h && !seen.has(h) && (h.includes('bestbuy') || h.startsWith('/'))) {
          seen.add(h);
          out.push({ pat, href: h.slice(0, 110), text: a.textContent?.trim()?.slice(0, 60) || '' });
        }
        if (out.length >= 8) break;
      }
      if (out.length >= 8) break;
    }
    return out;
  });
  links.forEach((l, i) => console.log(`  [${i+1}] ${l.pat}\n      ${l.href}\n      "${l.text}"`));
  if (!links.length) console.log('  (none found)');

  // ── 5. Selectores de precio ──────────────────────────────────────────────────
  console.log('\n─── Price selectors con valores: ───');
  const prices = await page.evaluate(() => {
    const sels = [
      '[data-testid="customer-price"] [aria-hidden="true"]',
      '[data-testid="customer-price"] span',
      '.priceView-customer-price [aria-hidden="true"]',
      '[class*="priceView-hero"] [aria-hidden="true"]',
      '[class*="Price"][class*="Block"] span',
      '[class*="CustomerPrice"] span',
      '[aria-label*="$"]',
      '[class*="price"][class*="current"]',
      'span[class*="Price"][aria-hidden="true"]',
    ];
    const out = {};
    for (const s of sels) {
      const vals = [...document.querySelectorAll(s)]
        .slice(0, 4)
        .map(e => e.textContent?.trim())
        .filter(t => t && /\d/.test(t));
      if (vals.length) out[s] = vals;
    }
    return out;
  });
  Object.entries(prices).forEach(([s, v]) => console.log(`  ${s}\n    → ${v.join(' | ')}`));
  if (!Object.keys(prices).length) console.log('  (none matched)');

  // ── 6. Primer item de la mejor ruta encontrada ────────────────────────────────
  if (found.length > 0) {
    console.log(`\n─── Primer item en "${found[0].path}": ───`);
    const firstItem = await page.evaluate((p) => {
      let cur = window.__INITIAL_STATE__;
      for (const k of p.split('.')) cur = cur?.[k];
      return Array.isArray(cur) ? cur[0] : null;
    }, found[0].path);
    if (firstItem) console.log(JSON.stringify(firstItem, null, 2).slice(0, 2000));
  }

  await page.screenshot({ path: path.join(outDir, `${keyword.replace(/\s+/g,'_')}.png`) });

  await page.close().catch(() => {});
  await ctx.close().catch(() => {});
  await closeBrowser().catch(() => {});

  console.log(`\n✅ Done. Logs: ${outDir}\n`);
}

main().catch(err => { console.error(err.message); process.exit(1); });

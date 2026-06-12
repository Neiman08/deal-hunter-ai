/**
 * Fase 1 — Validación aislada: ¿puede Playwright leer un producto de Office Depot?
 *
 * Sin proxy, sin DB, sin queue, sin worker, sin saveProductData.
 * Resultado binario: precio encontrado → sí funciona / bloqueado → no funciona.
 *
 * Uso:
 *   node backend/scripts/test-office-depot-playwright.js
 *
 * Salida:
 *   /tmp/od-test-screenshot.png
 *   /tmp/od-test-page.html
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.officedepot.com/a/products/100512/Aleve-Pain-Reliever-Tablets-1-Tablet/';
const SCREENSHOT_PATH = '/tmp/od-test-screenshot.png';
const HTML_PATH       = '/tmp/od-test-page.html';
const TIMEOUT_MS      = 30_000;

(async () => {
  console.log('═'.repeat(60));
  console.log('  Office Depot Playwright — Validación aislada');
  console.log('  URL:', TARGET_URL);
  console.log('═'.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const page = await context.newPage();

  let finalUrl = TARGET_URL;
  let navError = null;

  try {
    console.log('\n[1] Navegando...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    finalUrl = page.url();
    console.log('    URL final:', finalUrl);
    console.log('    Título:   ', await page.title());
  } catch (e) {
    navError = e.message;
    console.log('    ⚠️  Navigation error:', e.message);
    console.log('    Continuando con lo que cargó...');
    finalUrl = page.url();
  }

  console.log('\n[2] Esperando 5 segundos adicionales...');
  await new Promise(r => setTimeout(r, 5000));

  // ── Screenshot ──────────────────────────────────────────────────────────────
  console.log('\n[3] Guardando screenshot →', SCREENSHOT_PATH);
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });

  // ── HTML ────────────────────────────────────────────────────────────────────
  console.log('[4] Guardando HTML →', HTML_PATH);
  const html = await page.content();
  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.log('    HTML length:', html.length.toLocaleString(), 'chars');

  // ── Texto visible ────────────────────────────────────────────────────────────
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('    Texto visible length:', bodyText.length.toLocaleString(), 'chars');

  // ── Número de <script> tags ──────────────────────────────────────────────────
  const scriptCount = await page.evaluate(() => document.querySelectorAll('script').length);
  console.log('    Script tags:', scriptCount);

  // ── Detección de bloqueo ─────────────────────────────────────────────────────
  const title = await page.title();
  const isBlocked = /captcha|access denied|robot|blocked|verify|challenge|403/i.test(title)
    || /captcha|access denied|robot|blocked|verify|challenge/i.test(bodyText.slice(0, 2000));

  console.log('\n[5] ¿Bloqueado?', isBlocked ? '🔴 SÍ' : '🟢 No detectado');
  if (isBlocked) {
    console.log('    Título de bloqueo:', title);
    const blockSnippet = bodyText.slice(0, 500);
    console.log('    Texto:', blockSnippet);
  }

  // ── Búsqueda de patrones de datos ────────────────────────────────────────────
  console.log('\n[6] Buscando patrones de datos en HTML...');

  const patterns = {
    'LD+JSON':           /<script[^>]+type="application\/ld\+json"/i,
    'application/json':  /<script[^>]+type="application\/json"/i,
    '__NEXT_DATA__':     /__NEXT_DATA__/,
    '__INITIAL_STATE__': /__INITIAL_STATE__/,
    'window.__':         /window\.__\w+\s*=/,
    '"price":':          /"price"\s*:\s*[\d.]+/,
    '"currentPrice"':    /"currentPrice"/i,
    '"salePrice"':       /"salePrice"/i,
    '"offers"':          /"offers"/i,
    '"offers" (LD+JSON)':/"@type"\s*:\s*"Product"/i,
  };

  const found = {};
  for (const [label, rx] of Object.entries(patterns)) {
    found[label] = rx.test(html);
    console.log(`    ${found[label] ? '✅' : '❌'} ${label}`);
  }

  // ── Extracción de precio ─────────────────────────────────────────────────────
  console.log('\n[7] Intentando extraer precio...');

  // Intento 1: LD+JSON
  let priceFound = null;
  let priceSource = null;

  const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      const parsed = JSON.parse(ldMatch[1]);
      const item   = Array.isArray(parsed) ? parsed[0] : parsed;
      const offer  = Array.isArray(item?.offers) ? item.offers[0] : item?.offers;
      if (offer?.price) { priceFound = parseFloat(offer.price); priceSource = 'LD+JSON'; }
    } catch { /* continue */ }
  }

  // Intento 2: __NEXT_DATA__
  if (!priceFound) {
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        // Buscar cualquier "price" numérico en el árbol
        const dataStr = JSON.stringify(data);
        const prices  = [...dataStr.matchAll(/"(?:price|currentPrice|salePrice)"\s*:\s*([\d.]+)/gi)];
        if (prices.length) {
          priceFound  = parseFloat(prices[0][1]);
          priceSource = '__NEXT_DATA__';
          console.log('    __NEXT_DATA__ prices encontrados:', prices.slice(0, 3).map(m => m[0]));
        }
      } catch { /* continue */ }
    }
  }

  // Intento 3: window.__ state objects
  if (!priceFound) {
    const stateMatch = html.match(/window\.__\w+\s*=\s*(\{[\s\S]{0,5000})/);
    if (stateMatch) {
      const snippet = stateMatch[0];
      const priceM  = snippet.match(/"(?:price|currentPrice)"\s*:\s*([\d.]+)/i);
      if (priceM) { priceFound = parseFloat(priceM[1]); priceSource = 'window.__state'; }
    }
  }

  // Intento 4: texto visible del body (precio como texto en la página)
  if (!priceFound) {
    const textPriceM = bodyText.match(/\$\s*([\d]+\.[\d]{2})/);
    if (textPriceM) { priceFound = parseFloat(textPriceM[1]); priceSource = 'body text'; }
  }

  // ── Resultado final ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  if (priceFound) {
    console.log(`  ✅  CASO A — PRECIO ENCONTRADO: $${priceFound} (fuente: ${priceSource})`);
    console.log('  → Playwright funciona. Reescribir scraper usando Playwright.');
  } else if (isBlocked) {
    console.log('  🔴  CASO B — BLOQUEADO POR OD');
    console.log('  → Abrir Chrome DevTools → Network → buscar endpoint JSON con precio.');
  } else {
    console.log('  ⚠️   CASO C — HTTP 200 pero sin precio detectado');
    console.log('  → Página cargó (no bloqueado) pero precio no encontrado en HTML.');
    console.log('  → Posible: precio cargado por XHR post-render.');
    console.log('  → Ver /tmp/od-test-screenshot.png para ver qué renderizó.');
    console.log('\n  Fragmento de texto visible (primeros 500 chars):');
    console.log('  ' + bodyText.slice(0, 500).replace(/\n/g, '\n  '));
  }
  console.log('═'.repeat(60));
  console.log('\n  Screenshot: open', SCREENSHOT_PATH);
  console.log('  HTML:       open', HTML_PATH);

  await browser.close();
})();

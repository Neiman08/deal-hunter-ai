/**
 * Walmart Discovery Engine — Clearance / Rollback / Deals pages
 *
 * Strategy:
 *  1. Navigate listing pages with ISP proxy (bypasses Akamai)
 *  2. Wait up to 20s for React to hydrate and render product <a href="/ip/..."> links
 *  3. Fallback: extract usItemId from __NEXT_DATA__ / __WML_REDUX_INITIAL_STATE__ JSON
 *
 * Product URL pattern: walmart.com/ip/{name}/{itemId}
 */

const https = require('https');
const { runStoreDiscovery, safeGoto, scrollPage, filterNewUrls, sleep } = require('./baseRetailerDiscovery');
const { newIspContext }     = require('../browserEngine');
const { shouldSkipStore }   = require('../proxyManager');
const { writeStoreRun }     = require('../../utils/storeRunStats');
const { buildIspHttpProxyAgent } = require('../../utils/proxyUtils');
const { scanSingleProduct } = require('../../jobs/scanJob');
const logger = require('../../utils/logger');

// ─── Comprehensive ISP proxy diagnostic ──────────────────────────────────────
// Tests HTTP connectivity and Playwright navigation through the ISP proxy
// against 6 target URLs. Results stored in last_error for DB inspection.
// Classifies failure as:
//   Case A — proxy can't reach even ipify/google (credential/port issue)
//   Case B — proxy reaches simple sites but target domains block exit IPs
//   Case C — pages load; issue is selector/SPA extraction

const DIAG_URLS = [
  { label: 'ipify',     url: 'https://api.ipify.org?format=json' },
  { label: 'google',    url: 'https://www.google.com' },
  { label: 'bestbuy',   url: 'https://www.bestbuy.com' },
  { label: 'lowes',     url: 'https://www.lowes.com' },
  { label: 'homedepot', url: 'https://www.homedepot.com' },
  { label: 'walmart',   url: 'https://www.walmart.com' },
];

async function httpProbe(agent, { label, url }) {
  const start = Date.now();
  return new Promise((resolve) => {
    const reqOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
      rejectUnauthorized: false,
    };
    if (agent) reqOpts.agent = agent;
    const req = https.get(url, reqOpts, (res) => {
      let data = '';
      res.on('data', c => { data += c; if (data.length > 3000) res.destroy(); });
      res.on('close', () => {
        const elapsed = Date.now() - start;
        let exitIp = null;
        if (label === 'ipify') { try { exitIp = JSON.parse(data).ip; } catch {} }
        const preview = data.slice(0, 300).replace(/\s+/g, ' ');
        resolve({
          label, ok: true, status: res.statusCode, elapsed,
          htmlLen: data.length, exitIp, preview,
          akamai:  /akamai|edgesuite|reference #[0-9a-f.]+/i.test(preview),
          captcha: /captcha|verify.*human|robot/i.test(preview),
          denied:  /access denied|403 forbidden/i.test(preview),
        });
      });
      res.on('error', e => resolve({ label, ok: false, error: e.message, elapsed: Date.now() - start }));
    });
    req.on('error', e => resolve({ label, ok: false, error: e.message, elapsed: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ label, ok: false, error: 'timeout_20s', elapsed: 20000 }); });
  });
}

async function playwrightProbe(url, label) {
  const { safeGoto: sg } = require('./baseRetailerDiscovery');
  let ctx, page;
  const start = Date.now();
  try {
    ctx  = await newIspContext();
    page = await ctx.newPage();
    const nav = await sg(page, url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return {
      label, ok: nav.ok, elapsed: Date.now() - start,
      status:   nav.blockType || 'ok',
      htmlLen:  nav.htmlLen  || 0,
      title:    nav.title    || '',
      preview:  (nav.bodyText || '').slice(0, 200).replace(/\s+/g, ' '),
      captcha:  /captcha|verify.*human/i.test((nav.bodyText || '') + (nav.title || '')),
      akamai:   /akamai|edgesuite/i.test(nav.bodyText || ''),
      error:    nav.error    || null,
    };
  } catch (err) {
    return { label, ok: false, error: err.message, elapsed: Date.now() - start };
  } finally {
    if (page) await page.close().catch(() => {});
    if (ctx)  await ctx.close().catch(() => {});
  }
}

async function runFullDiagnostic() {
  const agent   = buildIspHttpProxyAgent('Walmart-diag');
  const proxyMeta = {
    host: process.env.ISP_PROXY_HOST || '(not set)',
    port: process.env.ISP_PROXY_PORT || '33335(default)',
    user: process.env.ISP_PROXY_USER ? '***set***' : '(not set)',
    agentBuilt: !!agent,
  };

  logger.info(`[Diag:Walmart] === FULL PROXY DIAGNOSTIC === proxy=${JSON.stringify(proxyMeta)}`);

  // Phase 1: HTTP probe all 6 URLs (Node.js https module + HttpsProxyAgent)
  const httpResults = [];
  for (const entry of DIAG_URLS) {
    const r = await httpProbe(agent, entry);
    httpResults.push(r);
    logger.info(`[Diag:HTTP] ${r.label}: ok=${r.ok} status=${r.status||'N/A'} htmlLen=${r.htmlLen||0} elapsed=${r.elapsed}ms exitIp=${r.exitIp||'N/A'} err=${r.error||'none'} akamai=${r.akamai||false}`);
  }

  // Phase 2: Playwright probe — google (simple site) and lowes (Akamai site)
  const pwGoogle = await playwrightProbe('https://www.google.com', 'pw:google');
  logger.info(`[Diag:PW] google: ok=${pwGoogle.ok} htmlLen=${pwGoogle.htmlLen} elapsed=${pwGoogle.elapsed}ms status=${pwGoogle.status} err=${pwGoogle.error||'none'}`);

  const pwLowes  = await playwrightProbe('https://www.lowes.com', 'pw:lowes');
  logger.info(`[Diag:PW] lowes:  ok=${pwLowes.ok} htmlLen=${pwLowes.htmlLen} elapsed=${pwLowes.elapsed}ms status=${pwLowes.status} err=${pwLowes.error||'none'}`);

  // Classify
  const ipifyOk  = httpResults.find(r => r.label === 'ipify')?.ok && httpResults.find(r => r.label === 'ipify')?.status < 400;
  const googleOk = httpResults.find(r => r.label === 'google')?.ok && httpResults.find(r => r.label === 'google')?.status < 400;
  const exitIp   = httpResults.find(r => r.label === 'ipify')?.exitIp || null;

  let caseClassification;
  if (!ipifyOk && !googleOk) {
    caseClassification = 'A:proxy_not_working_even_for_simple_sites';
  } else if (ipifyOk && pwLowes && !pwLowes.ok) {
    caseClassification = 'B:proxy_works_http_but_akamai_sites_block_browser';
  } else if (ipifyOk && pwLowes && pwLowes.ok) {
    caseClassification = 'C:pages_load_check_selectors';
  } else {
    caseClassification = 'unknown';
  }

  logger.info(`[Diag:Walmart] CASE=${caseClassification} exitIp=${exitIp}`);

  return { proxyMeta, httpResults, playwright: { google: pwGoogle, lowes: pwLowes }, exitIp, case: caseClassification };
}

const STORE_SLUG  = 'walmart';
const STORE_LABEL = 'Walmart';

const DISCOVERY_PAGES = [
  { label: 'clearance',             url: 'https://www.walmart.com/browse/clearance' },
  { label: 'rollback',              url: 'https://www.walmart.com/shop/deals/rollback' },
  { label: 'deals',                 url: 'https://www.walmart.com/shop/deals' },
  { label: 'electronics-clearance', url: 'https://www.walmart.com/browse/electronics/clearance/3944_1105910?facet=deal_type:Clearance' },
  { label: 'home-clearance',        url: 'https://www.walmart.com/browse/home/clearance/4044_623679?facet=deal_type:Clearance' },
  { label: 'seasonal-rollback',     url: 'https://www.walmart.com/browse/seasonal/rollback/976759?facet=deal_type:Rollback' },
];

function linkFilter(href) {
  return !!(href && href.match(/walmart\.com\/ip\/[^/?#]+\/\d+/));
}
function cleanUrl(href) {
  const base = href.startsWith('http') ? href : `https://www.walmart.com${href}`;
  return base.split('?')[0].split('#')[0];
}

// Extract product URLs from Walmart's embedded page JSON and inline scripts
async function extractJsonUrls(page) {
  return page.evaluate(() => {
    const urls = [];

    // Method A: __NEXT_DATA__ structured walk
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) {
        const data = JSON.parse(el.textContent || '{}');
        const walk = (obj, depth) => {
          if (depth > 12 || !obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) { obj.forEach(v => walk(v, depth + 1)); return; }
          const id = obj.usItemId || obj.itemId;
          if (id && /^\d{6,}$/.test(String(id))) {
            const slug = (obj.name || obj.productName || obj.displayName || 'product')
              .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/-+$/, '');
            urls.push(`/ip/${slug}/${id}`);
          }
          if (typeof obj.canonicalUrl === 'string' && obj.canonicalUrl.includes('/ip/')) {
            urls.push(obj.canonicalUrl.startsWith('/') ? obj.canonicalUrl : `/${obj.canonicalUrl}`);
          }
          Object.values(obj).forEach(v => walk(v, depth + 1));
        };
        walk(data, 0);
      }
    } catch { /* ignore */ }

    // Method B: scan ALL inline scripts for "usItemId":"123456" pattern
    // Works even when JSON structure changes — finds IDs anywhere on the page
    try {
      if (urls.length === 0) {
        document.querySelectorAll('script:not([src])').forEach(s => {
          const text = s.textContent || '';
          if (!text.includes('usItemId')) return;
          const re = /"usItemId"\s*:\s*"(\d{6,})"/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            urls.push(`/ip/product/${m[1]}`);
          }
        });
      }
    } catch { /* ignore */ }

    return [...new Set(urls)];
  }).catch(() => []);
}

// Custom URL collection that combines DOM + JSON extraction
async function collectUrls(maxTotal) {
  const allRaw = [];
  const diagPages = [];
  let consecutiveEmpty = 0;
  const MAX_CONSECUTIVE = 3;

  for (const p of DISCOVERY_PAGES) {
    if (allRaw.length >= maxTotal * 3) break;
    if (consecutiveEmpty >= MAX_CONSECUTIVE) {
      logger.warn(`[Discovery:${STORE_LABEL}] ${MAX_CONSECUTIVE} consecutive empty — stopping URL collection`);
      break;
    }

    logger.info(`\n[Discovery:${STORE_LABEL}] ── ${p.label}`);
    let ctx, page;
    try {
      ctx  = await newIspContext();
      page = await ctx.newPage();

      // Use domcontentloaded — 'load' never fires on Walmart SPAs (ongoing API calls).
      // Then waitForSelector waits up to 20s for React to hydrate product links.
      const nav = await safeGoto(page, p.url, { waitUntil: 'domcontentloaded', timeout: 40000 });

      if (!nav.ok) {
        const diag = {
          label: p.label, status: nav.blockType || 'failed',
          error: (nav.error || '').slice(0, 300),
          title: nav.title || '', htmlLen: nav.htmlLen || 0,
          bodyPreview: (nav.bodyText || '').slice(0, 300).replace(/\s+/g, ' '),
          captcha: /captcha|verify.*human|robot/i.test((nav.bodyText || '') + (nav.title || '')),
          akamai:  /akamai|edgesuite/i.test(nav.bodyText || ''),
        };
        diagPages.push(diag);
        logger.warn(`[Diag:${STORE_LABEL}] ${p.label} FAILED | type=${diag.status} | err="${diag.error}" | htmlLen=${diag.htmlLen} | title="${diag.title}" | captcha=${diag.captcha} | akamai=${diag.akamai} | body="${diag.bodyPreview.slice(0,150)}"`);
        consecutiveEmpty++;
        continue;
      }

      // Wait up to 20s for React to inject product <a href="/ip/..."> links
      await page.waitForSelector('a[href*="/ip/"]', { timeout: 20000 }).catch(() => {});
      await scrollPage(page);

      // Method 1: DOM link extraction — accept both relative (/ip/...) and absolute URLs
      const domLinks = await page.evaluate(() => {
        const found = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          if (href) found.add(href);
        });
        return [...found];
      }).catch(() => []);

      const domFiltered = domLinks
        .filter(href => href && (
          href.match(/walmart\.com\/ip\/[^/?#]+\/\d+/) ||
          href.match(/^\/ip\/[^/?#]+\/\d+/)
        ))
        .map(cleanUrl).filter(Boolean);

      // Method 2: JSON extraction fallback (works even when DOM extraction fails)
      let jsonFiltered = [];
      if (domFiltered.length === 0) {
        const jsonLinks = await extractJsonUrls(page);
        jsonFiltered = jsonLinks.map(cleanUrl).filter(Boolean);
      }

      const combined = domFiltered.length > 0 ? domFiltered : jsonFiltered;

      // Capture per-page diagnostic info
      const diagOk = {
        label: p.label, status: 'ok',
        title: nav.title || '', htmlLen: nav.htmlLen || 0,
        bodyPreview: (nav.bodyText || '').slice(0, 300).replace(/\s+/g, ' '),
        totalLinks: domLinks.length, domFiltered: domFiltered.length,
        jsonFiltered: jsonFiltered.length,
        captcha: /captcha|verify.*human|robot/i.test((nav.bodyText || '') + (nav.title || '')),
        akamai:  /akamai|edgesuite/i.test(nav.bodyText || ''),
        denied:  /access denied|403/i.test((nav.bodyText || '') + (nav.title || '')),
      };
      diagPages.push(diagOk);
      logger.info(`[Diag:${STORE_LABEL}] ${p.label} OK | htmlLen=${diagOk.htmlLen} | title="${diagOk.title}" | allLinks=${domLinks.length} | domFiltered=${domFiltered.length} | json=${jsonFiltered.length} | captcha=${diagOk.captcha} | akamai=${diagOk.akamai} | body="${diagOk.bodyPreview.slice(0,150)}"`);

      logger.info(`[Discovery:${STORE_LABEL}]   DOM=${domFiltered.length} JSON=${jsonFiltered.length} → using ${combined.length}`);

      if (combined.length > 0) {
        allRaw.push(...combined);
        consecutiveEmpty = 0;
      } else {
        consecutiveEmpty++;
      }

    } catch (err) {
      logger.error(`[Discovery:${STORE_LABEL}]   Error: ${err.message}`);
      diagPages.push({ label: p.label, status: 'exception', error: err.message });
      consecutiveEmpty++;
    } finally {
      if (page) await page.close().catch(() => {});
      if (ctx)  await ctx.close().catch(() => {});
    }

    await sleep(2000);
  }

  return { urls: allRaw, diag: diagPages };
}

async function runWalmartDiscovery(options = {}) {
  const startedAt = Date.now();
  const maxTotal  = options.maxTotal || 150;
  const delayMs   = options.delayMs  || 2000;

  const stats = {
    store: STORE_SLUG, pages_visited: 0, urls_discovered: 0,
    urls_new: 0, saved: 0, no_price: 0, errors: 0, blocked: false, blockType: null,
  };

  if (shouldSkipStore(STORE_SLUG)) {
    logger.warn(`[Discovery:${STORE_LABEL}] Skipping — too many recent failures`);
    stats.blocked = true; stats.blockType = 'skipped_due_to_failures';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY`);
  logger.info('═'.repeat(60));

  // Full proxy diagnostic before Playwright navigation
  const probeResult = await runFullDiagnostic();

  // Phase 1: collect product URLs
  let allRaw, collectDiag;
  try {
    ({ urls: allRaw, diag: collectDiag } = await collectUrls(maxTotal));
  } catch (err) {
    logger.error(`[Discovery:${STORE_LABEL}] collectUrls fatal: ${err.message}`);
    stats.errors = 1; stats.blocked = true; stats.blockType = 'fatal_error';
    stats.last_error = JSON.stringify({ probe: probeResult, error: err.message });
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  stats.pages_visited   = DISCOVERY_PAGES.length;
  stats.urls_discovered = allRaw.length;
  stats.last_error      = JSON.stringify({ diag: probeResult, pages: collectDiag }).slice(0, 8000);

  if (!allRaw.length) {
    logger.warn(`[Discovery:${STORE_LABEL}] No URLs found across all pages`);
    stats.blocked = true; stats.blockType = 'no_urls_found';
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  // Phase 2: dedup
  const unique   = [...new Set(allRaw)];
  const newUrls  = await filterNewUrls(unique, STORE_LABEL);
  stats.urls_new = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info(`[Discovery:${STORE_LABEL}] All URLs already in DB`);
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info(`\n[Discovery:${STORE_LABEL}] Scanning ${toProcess.length} new products...`);

  // Phase 3: scan
  const CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY) || 2;

  async function scanOne(url, idx) {
    logger.info(`[Discovery:${STORE_LABEL}] [${idx + 1}/${toProcess.length}] ${url}`);
    try {
      const result = await scanSingleProduct(STORE_SLUG, url);
      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        const discStr = result.regularPrice
          ? `${Math.round((1 - result.currentPrice / result.regularPrice) * 100)}% off`
          : 'no reg price';
        logger.info(`[Discovery:${STORE_LABEL}]   ✅ $${result.currentPrice} | ${discStr} | "${result.name || ''}"`);
      } else {
        stats.no_price++;
      }
    } catch (err) {
      stats.errors++;
      logger.error(`[Discovery:${STORE_LABEL}]   ❌ ${err.message}`);
    }
    await sleep(delayMs);
  }

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    await Promise.all(
      toProcess.slice(i, i + CONCURRENCY).map((url, j) => scanOne(url, i + j))
    );
  }

  logger.info('═'.repeat(60));
  logger.info(`🏪 ${STORE_LABEL.toUpperCase()} DISCOVERY — COMPLETE`);
  logger.info(`   found:${stats.urls_discovered} new:${stats.urls_new} saved:${stats.saved} errors:${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runWalmartDiscovery, runDiscovery: runWalmartDiscovery };

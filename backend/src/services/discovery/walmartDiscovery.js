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

// ISP proxy HTTP probe — checks reachability and returns exit IP.
// Result written to last_error for DB inspection.
async function probeIspProxy() {
  const agent = buildIspHttpProxyAgent('Walmart-probe');
  const host  = process.env.ISP_PROXY_HOST || '(not set)';
  const port  = process.env.ISP_PROXY_PORT || '33335';
  const user  = process.env.ISP_PROXY_USER ? '***set***' : '(not set)';
  if (!agent) return { ok: false, error: 'no_agent', host, port, user };

  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=json',
      { agent, timeout: 15000, rejectUnauthorized: false },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const ip = JSON.parse(data).ip || data.slice(0, 80);
            resolve({ ok: true, status: res.statusCode, exitIp: ip, host, port, user });
          } catch {
            resolve({ ok: true, status: res.statusCode, body: data.slice(0, 80), host, port, user });
          }
        });
        res.on('error', e => resolve({ ok: false, error: e.message, host, port, user }));
      }
    );
    req.on('error', e => resolve({ ok: false, error: e.message, host, port, user }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'probe_timeout_15s', host, port, user }); });
  });
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

  // Probe ISP proxy connectivity before attempting Playwright navigation
  const probeResult = await probeIspProxy();
  logger.info(`[Diag:${STORE_LABEL}] ISP proxy probe: ${JSON.stringify(probeResult)}`);

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
  stats.last_error      = JSON.stringify({ probe: probeResult, pages: collectDiag }).slice(0, 8000);

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

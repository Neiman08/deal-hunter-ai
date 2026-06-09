/**
 * Target Discovery Engine — Playwright-based (restored from working version)
 *
 * Opens Target search/category pages with Playwright (no proxy — Target listing
 * pages work fine from datacenter IPs), extracts product URLs from the SPA DOM,
 * then scrapes each new URL via scanSingleProduct.
 *
 * The Redsky HTTP API approach was replaced because redsky.target.com returns
 * a CAPTCHA JSON for all requests regardless of proxy.
 */

const { newBestBuyContext } = require('../browserEngine');
const { query }             = require('../../config/database');
const { writeStoreRun }     = require('../../utils/storeRunStats');
const logger                = require('../../utils/logger');

const STORE_SLUG = 'target';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Page groups — one group runs per 30-min cycle in rotation
const TARGET_PAGE_GROUPS = {
  electronics: [
    { label: 'search-samsung',     url: 'https://www.target.com/s?searchTerm=samsung' },
    { label: 'search-sony',        url: 'https://www.target.com/s?searchTerm=sony' },
    { label: 'search-monitor',     url: 'https://www.target.com/s?searchTerm=monitor' },
    { label: 'search-printer',     url: 'https://www.target.com/s?searchTerm=printer' },
    { label: 'search-camera',      url: 'https://www.target.com/s?searchTerm=camera' },
    { label: 'search-smart-home',  url: 'https://www.target.com/s?searchTerm=smart%20home' },
    { label: 'search-ring-camera', url: 'https://www.target.com/s?searchTerm=ring%20camera' },
    { label: 'search-projector',   url: 'https://www.target.com/s?searchTerm=projector' },
    { label: 'deals-electronics',  url: 'https://www.target.com/c/electronics/deals/-/N-5xtg6Z4y1b5' },
  ],
  airpods: [
    { label: 'search-airpods',     url: 'https://www.target.com/s?searchTerm=airpods' },
    { label: 'search-airpods-pro', url: 'https://www.target.com/s?searchTerm=airpods+pro' },
    { label: 'search-apple-watch', url: 'https://www.target.com/s?searchTerm=apple%20watch' },
    { label: 'search-macbook',     url: 'https://www.target.com/s?searchTerm=macbook' },
    { label: 'search-ipad',        url: 'https://www.target.com/s?searchTerm=ipad' },
    { label: 'search-iphone',      url: 'https://www.target.com/s?searchTerm=iphone' },
  ],
  headphones: [
    { label: 'search-headphones',  url: 'https://www.target.com/s?searchTerm=headphones' },
    { label: 'search-bose',        url: 'https://www.target.com/s?searchTerm=bose' },
    { label: 'search-speaker',     url: 'https://www.target.com/s?searchTerm=bluetooth+speaker' },
    { label: 'search-soundbar',    url: 'https://www.target.com/s?searchTerm=soundbar' },
    { label: 'search-earbuds',     url: 'https://www.target.com/s?searchTerm=wireless+earbuds' },
    { label: 'search-gaming-headset', url: 'https://www.target.com/s?searchTerm=gaming+headset' },
  ],
  vacuum: [
    { label: 'search-vacuum',      url: 'https://www.target.com/s?searchTerm=vacuum' },
    { label: 'search-dyson',       url: 'https://www.target.com/s?searchTerm=dyson' },
    { label: 'search-robot-vacuum',url: 'https://www.target.com/s?searchTerm=robot%20vacuum' },
    { label: 'search-shark',       url: 'https://www.target.com/s?searchTerm=shark%20vacuum' },
    { label: 'search-bissell',     url: 'https://www.target.com/s?searchTerm=bissell' },
    { label: 'search-roomba',      url: 'https://www.target.com/s?searchTerm=roomba' },
  ],
  kitchen: [
    { label: 'search-kitchenaid',  url: 'https://www.target.com/s?searchTerm=kitchenaid' },
    { label: 'search-ninja',       url: 'https://www.target.com/s?searchTerm=ninja' },
    { label: 'search-keurig',      url: 'https://www.target.com/s?searchTerm=keurig' },
    { label: 'search-air-fryer',   url: 'https://www.target.com/s?searchTerm=air%20fryer' },
    { label: 'search-coffee-maker',url: 'https://www.target.com/s?searchTerm=coffee%20maker' },
    { label: 'search-instant-pot', url: 'https://www.target.com/s?searchTerm=instant+pot' },
    { label: 'search-vitamix',     url: 'https://www.target.com/s?searchTerm=vitamix' },
    { label: 'search-stand-mixer', url: 'https://www.target.com/s?searchTerm=stand+mixer' },
    { label: 'deals-kitchen',      url: 'https://www.target.com/c/kitchen-dining/deals/-/N-hz89eZ4y1b5' },
  ],
  tv: [
    { label: 'search-tv',          url: 'https://www.target.com/s?searchTerm=tv' },
    { label: 'search-oled-tv',     url: 'https://www.target.com/s?searchTerm=oled+tv' },
    { label: 'search-samsung-tv',  url: 'https://www.target.com/s?searchTerm=samsung+tv' },
    { label: 'search-lg-tv',       url: 'https://www.target.com/s?searchTerm=lg+tv' },
    { label: 'search-soundbar',    url: 'https://www.target.com/s?searchTerm=soundbar' },
    { label: 'search-projector',   url: 'https://www.target.com/s?searchTerm=projector' },
  ],
  laptop: [
    { label: 'search-laptop',      url: 'https://www.target.com/s?searchTerm=laptop' },
    { label: 'search-hp-laptop',   url: 'https://www.target.com/s?searchTerm=hp%20laptop' },
    { label: 'search-lenovo-laptop',url: 'https://www.target.com/s?searchTerm=lenovo%20laptop' },
    { label: 'search-dell-laptop', url: 'https://www.target.com/s?searchTerm=dell+laptop' },
    { label: 'search-asus-laptop', url: 'https://www.target.com/s?searchTerm=asus+laptop' },
    { label: 'search-chromebook',  url: 'https://www.target.com/s?searchTerm=chromebook' },
  ],
  gaming: [
    { label: 'search-gaming',      url: 'https://www.target.com/s?searchTerm=gaming' },
    { label: 'search-ps5',         url: 'https://www.target.com/s?searchTerm=ps5' },
    { label: 'search-xbox',        url: 'https://www.target.com/s?searchTerm=xbox' },
    { label: 'search-nintendo',    url: 'https://www.target.com/s?searchTerm=nintendo%20switch' },
    { label: 'search-gaming-chair',url: 'https://www.target.com/s?searchTerm=gaming%20chair' },
    { label: 'search-pokemon',     url: 'https://www.target.com/s?searchTerm=pokemon' },
    { label: 'search-lego',        url: 'https://www.target.com/s?searchTerm=lego' },
  ],
  apple: [
    { label: 'search-apple',       url: 'https://www.target.com/s?searchTerm=apple' },
    { label: 'search-ipad',        url: 'https://www.target.com/s?searchTerm=ipad' },
    { label: 'search-iphone',      url: 'https://www.target.com/s?searchTerm=iphone' },
    { label: 'search-macbook',     url: 'https://www.target.com/s?searchTerm=macbook' },
    { label: 'search-airpods',     url: 'https://www.target.com/s?searchTerm=airpods' },
    { label: 'search-apple-watch', url: 'https://www.target.com/s?searchTerm=apple%20watch' },
  ],
  clearance: [
    { label: 'clearance-all',      url: 'https://www.target.com/c/clearance/-/N-5q0gi' },
    { label: 'deals-electronics',  url: 'https://www.target.com/c/electronics/deals/-/N-5xtg6Z4y1b5' },
    { label: 'deals-home',         url: 'https://www.target.com/c/home/deals/-/N-5xtvgZ4y1b5' },
    { label: 'deals-kitchen',      url: 'https://www.target.com/c/kitchen-dining/deals/-/N-hz89eZ4y1b5' },
    { label: 'deals-toys',         url: 'https://www.target.com/c/toys/deals/-/N-5xt9aZ4y1b5' },
    { label: 'deals-sports',       url: 'https://www.target.com/c/sports-outdoors/deals/-/N-5xtleZ4y1b5' },
  ],
  patio: [
    { label: 'search-patio',       url: 'https://www.target.com/s?searchTerm=patio+furniture' },
    { label: 'search-outdoor-grill',url: 'https://www.target.com/s?searchTerm=gas+grill' },
    { label: 'search-power-tools', url: 'https://www.target.com/s?searchTerm=power+tools' },
    { label: 'search-dewalt',      url: 'https://www.target.com/s?searchTerm=dewalt' },
    { label: 'search-Milwaukee',   url: 'https://www.target.com/s?searchTerm=milwaukee+tools' },
  ],
  furniture: [
    { label: 'search-office-chair',url: 'https://www.target.com/s?searchTerm=office%20chair' },
    { label: 'search-desk',        url: 'https://www.target.com/s?searchTerm=standing+desk' },
    { label: 'search-mattress',    url: 'https://www.target.com/s?searchTerm=mattress' },
    { label: 'search-gaming-desk', url: 'https://www.target.com/s?searchTerm=gaming%20desk' },
    { label: 'search-bedding',     url: 'https://www.target.com/s?searchTerm=luxury+bedding' },
    { label: 'deals-home',         url: 'https://www.target.com/c/home/deals/-/N-5xtvgZ4y1b5' },
  ],
  appliances: [
    { label: 'search-blender',     url: 'https://www.target.com/s?searchTerm=blender' },
    { label: 'search-cast-iron',   url: 'https://www.target.com/s?searchTerm=cast+iron' },
    { label: 'search-le-creuset',  url: 'https://www.target.com/s?searchTerm=le+creuset' },
    { label: 'search-oral-b',      url: 'https://www.target.com/s?searchTerm=oral-b' },
    { label: 'search-hair-dryer',  url: 'https://www.target.com/s?searchTerm=hair+dryer' },
    { label: 'search-funko-pop',   url: 'https://www.target.com/s?searchTerm=funko+pop' },
    { label: 'search-barbie',      url: 'https://www.target.com/s?searchTerm=barbie' },
    { label: 'search-hot-wheels',  url: 'https://www.target.com/s?searchTerm=hot+wheels' },
  ],
};

const DISCOVERY_PAGES = Object.values(TARGET_PAGE_GROUPS).flat();

async function extractUrlsFromListingPage(listingUrl, maxUrls = 30) {
  logger.info(`[Discovery:Target] Extracting URLs from: ${listingUrl}`);

  const ctx  = await newBestBuyContext();
  const page = await ctx.newPage();
  const urls = [];

  try {
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const title = await page.title().catch(() => '');
    logger.info(`[Discovery:Target]   title: "${title}"`);

    if (/captcha|robot|access denied|403/i.test(title)) {
      logger.warn(`[Discovery:Target]   Blocked: "${title}"`);
      return [];
    }

    try {
      await page.waitForSelector(
        '[class*="ProductCardWrapper"], [data-test="product-details"], [class*="ProductCard"]',
        { timeout: 15000 }
      );
    } catch {
      logger.warn('[Discovery:Target]   Grid timeout — trying anyway');
    }

    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, 600);
        await new Promise(r => setTimeout(r, 500));
      }
    });
    await sleep(1200);

    const extracted = await page.evaluate((max) => {
      const found = new Set();

      document.querySelectorAll('a[href*="/p/"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.includes('/p/') && href.includes('/A-')) {
          const abs   = href.startsWith('http') ? href : `https://www.target.com${href}`;
          found.add(abs.split('#')[0]);
        }
      });

      if (found.size < max) {
        document.querySelectorAll(
          '[class*="ProductCard"] a[href*="/p/"], [data-component="ProductCardWrapper"] a[href*="/p/"]'
        ).forEach(a => {
          const href = a.getAttribute('href') || '';
          if (href.includes('/p/')) {
            const abs = href.startsWith('http') ? href : `https://www.target.com${href}`;
            found.add(abs.split('#')[0]);
          }
        });
      }

      if (found.size < max) {
        try {
          const q = window?.__PRELOADED_QUERIES__?.queries;
          if (q) {
            for (const [, data] of Object.entries(q)) {
              const items = data?.data?.search?.products || data?.data?.nativeSearchV2?.items || [];
              if (!Array.isArray(items)) continue;
              for (const item of items) {
                const tcin = item?.tcin || item?.item?.tcin;
                if (tcin) found.add(`https://www.target.com/p/-/A-${tcin}`);
                if (found.size >= max) break;
              }
              if (found.size >= max) break;
            }
          }
        } catch {}
      }

      return [...found].slice(0, max);
    }, maxUrls);

    urls.push(...extracted);
    logger.info(`[Discovery:Target]   Extracted ${urls.length} URLs`);

  } catch (err) {
    logger.error(`[Discovery:Target]   Page error: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }

  return urls;
}

async function filterNewUrls(urls) {
  if (!urls.length) return [];
  const existing = await query(
    `SELECT product_url FROM products WHERE product_url = ANY($1::text[])`, [urls]
  );
  const existingSet = new Set(existing.rows.map(r => r.product_url));
  const newUrls = urls.filter(u => !existingSet.has(u));
  logger.info(`[Discovery:Target] Dedup: ${urls.length} total → ${existingSet.size} in DB → ${newUrls.length} new`);
  return newUrls;
}

async function runTargetDiscovery(options = {}) {
  const startedAt  = Date.now();
  const maxPerPage = options.maxPerPage || 25;
  const maxTotal   = options.maxTotal   || 50;
  const delayMs    = options.delayMs    || 3000;

  const cycleNum  = Math.floor(Date.now() / (30 * 60 * 1000));
  let pages;
  if (options.pages) {
    pages = options.pages;
  } else {
    const groupKeys = Object.keys(TARGET_PAGE_GROUPS);
    const groupKey  = groupKeys[cycleNum % groupKeys.length];
    pages           = TARGET_PAGE_GROUPS[groupKey];
    logger.info(`   group="${groupKey}" (cycle #${cycleNum})`);
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info('🎯 TARGET DISCOVERY ENGINE');
  logger.info(`   maxPerPage=${maxPerPage}  maxTotal=${maxTotal}  delayMs=${delayMs}  pages=${pages.length}`);
  logger.info('═'.repeat(60));

  const stats = {
    pages_visited: 0, urls_discovered: 0, urls_new: 0,
    saved: 0, no_price: 0, errors: 0, blocked: false,
  };

  const { scanSingleProduct } = require('../../jobs/scanJob');

  const allRawUrls = [];
  let consecutiveEmpty = 0;
  const MAX_CONSECUTIVE_EMPTY = 3;

  for (const p of pages) {
    if (allRawUrls.length >= maxTotal * 3) break;
    if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
      logger.warn(`[Discovery:Target] ${MAX_CONSECUTIVE_EMPTY} consecutive empty pages — stopping early`);
      stats.blocked = true;
      break;
    }

    logger.info(`\n[Discovery:Target] ── Page: ${p.label}`);
    const raw = await extractUrlsFromListingPage(p.url, maxPerPage);
    stats.pages_visited++;
    stats.urls_discovered += raw.length;
    allRawUrls.push(...raw);

    if (raw.length === 0) consecutiveEmpty++;
    else consecutiveEmpty = 0;

    await sleep(1500);
  }

  if (!allRawUrls.length) {
    logger.warn('[Discovery:Target] No URLs extracted — skipping scan phase.');
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  const uniqueAll = [...new Set(allRawUrls)];
  const newUrls   = await filterNewUrls(uniqueAll);
  stats.urls_new  = newUrls.length;
  const toProcess = newUrls.slice(0, maxTotal);

  if (!toProcess.length) {
    logger.info('[Discovery:Target] All discovered URLs already in DB.');
    await writeStoreRun(STORE_SLUG, startedAt, stats);
    return stats;
  }

  logger.info(`\n[Discovery:Target] Processing ${toProcess.length} new URLs...`);

  for (let i = 0; i < toProcess.length; i++) {
    const url = toProcess[i];
    logger.info(`[Discovery:Target] [${i + 1}/${toProcess.length}] ${url}`);

    try {
      const result = await scanSingleProduct(STORE_SLUG, url);
      if (result?.currentPrice && result?.saved) {
        stats.saved++;
        logger.info(`[Discovery:Target]   ✅ $${result.currentPrice} | "${result.name || ''}"`);
      } else if (!result?.currentPrice) {
        stats.no_price++;
        logger.warn(`[Discovery:Target]   ⚠️  no price`);
      }
    } catch (err) {
      stats.errors++;
      stats.last_error = err.message;
      logger.error(`[Discovery:Target]   ❌ ${err.message}`);
    }

    if (i < toProcess.length - 1) await sleep(delayMs);
  }

  logger.info('\n' + '═'.repeat(60));
  logger.info('🎯 TARGET DISCOVERY — COMPLETE');
  logger.info(`   pages_visited:${stats.pages_visited} | urls_discovered:${stats.urls_discovered} | new:${stats.urls_new} | saved:${stats.saved} | errors:${stats.errors}`);
  logger.info('═'.repeat(60) + '\n');

  await writeStoreRun(STORE_SLUG, startedAt, stats);
  return stats;
}

module.exports = { runTargetDiscovery, runDiscovery: runTargetDiscovery, extractUrlsFromListingPage, DISCOVERY_PAGES };

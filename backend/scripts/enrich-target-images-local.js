/**
 * Local enrichment script for Target product images.
 * Runs FROM LOCAL (not from Render) because Target's CDN blocks datacenter IPs.
 *
 * Flow:
 *   1. Login to production API to get admin token
 *   2. Fetch NEEDS_IMAGE Target deals from public feed
 *   3. For each product, locally fetch og:image from target.com
 *   4. Push collected images to POST /api/admin/push-product-images
 *
 * Run: node scripts/enrich-target-images-local.js [--limit N]
 * Prerequisites: NODE_ENV not required — uses PROD_API_URL
 */

const https = require('https');
const http  = require('http');

const PROD_URL    = 'https://deal-hunter-ai.onrender.com';
const ADMIN_EMAIL = 'admin@dealhunter.ai';
const ADMIN_PASS  = 'admin123';
const DELAY_MS    = 600;

const args     = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT    = limitArg >= 0 ? parseInt(args[limitArg + 1]) || 20 : 20;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function apiRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'deal-hunter-ai.onrender.com',
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      timeout: 15000,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function fetchOgImage(url, redirects = 0) {
  if (redirects > 3) return Promise.resolve(null);
  return new Promise(resolve => {
    const client  = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent':      UA,
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    };
    try {
      const req = client.get(url, options, response => {
        const { statusCode, headers } = response;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume();
          return fetchOgImage(headers.location, redirects + 1).then(resolve);
        }
        if (statusCode !== 200) { response.resume(); return resolve(null); }
        let html = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { html += chunk; if (html.length > 80000) response.destroy(); });
        response.on('end', () => {
          // Target format: content="..." property="og:image"
          const m = html.match(/<meta[^>]+content="(https:\/\/target\.scene7\.com\/[^"]+)"[^>]*property="og:image"/i)
                 || html.match(/<meta[^>]+property="og:image"[^>]+content="(https:\/\/[^"]+)"/i)
                 || html.match(/<meta[^>]+content="(https:\/\/[^"]+)"[^>]*property="og:image"/i);
          resolve(m ? m[1] : null);
        });
        response.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

async function main() {
  console.log(`=== Target Image Enrichment (local) — limit=${LIMIT} ===\n`);

  // Step 1: login
  console.log('1. Logging in to production...');
  const loginRes = await apiRequest('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (!loginRes.token) {
    console.error('Login failed:', loginRes.error || JSON.stringify(loginRes));
    process.exit(1);
  }
  const TOKEN = loginRes.token;
  console.log(`   Logged in as ${loginRes.user?.email} (admin=${loginRes.user?.is_admin})\n`);

  // Step 2: fetch Target NEEDS_IMAGE products
  console.log('2. Fetching Target deals from production...');
  const feedRes = await apiRequest('GET', `/api/deals?store=target&min_discount=0&limit=${LIMIT}`, null, TOKEN);
  const deals   = feedRes.deals || [];
  const before  = { total: feedRes.total, with_img: deals.filter(d => d.image_url).length, without_img: deals.filter(d => !d.image_url).length };
  console.log(`   Found ${deals.length} Target deals (total=${feedRes.total}) | with_img=${before.with_img} | without_img=${before.without_img}\n`);

  if (!deals.length) {
    console.log('No Target deals found. Nothing to do.');
    return;
  }

  // Step 3: locally fetch og:images
  console.log('3. Fetching og:images from target.com (local connection)...');
  const updates = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    const url  = deal.product_url;
    if (!url || deal.image_url) {
      console.log(`  [${i+1}/${deals.length}] SKIP (already has image or no URL): ${deal.name?.slice(0,40)}`);
      continue;
    }

    const img = await fetchOgImage(url);
    if (img) {
      console.log(`  [${i+1}/${deals.length}] ✅ "${deal.name?.slice(0,45)}" → ${img.slice(0,60)}`);
      updates.push({ product_url: url, image_url: img });
    } else {
      console.log(`  [${i+1}/${deals.length}] ❌ No og:image: ${deal.name?.slice(0,45)}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n   Fetched ${updates.length}/${deals.length} images\n`);

  if (!updates.length) {
    console.log('No images recovered. Check if target.com is accessible from your network.');
    return;
  }

  // Step 4: push to production
  console.log('4. Pushing images to production...');
  const pushRes = await apiRequest('POST', '/api/admin/push-product-images', { updates }, TOKEN);
  console.log(`   Submitted=${pushRes.submitted} | Applied=${pushRes.applied}`);
  if (pushRes.results?.length) {
    for (const r of pushRes.results) {
      console.log(`   ${r.outcome === 'applied' ? '✅' : '⚠️ '} ${r.product_url} → ${r.outcome}`);
    }
  }

  // Step 5: verify
  console.log('\n5. Verifying after enrichment...');
  await sleep(1000);
  const afterRes = await apiRequest('GET', `/api/deals?store=target&min_discount=0&limit=${LIMIT}`, null, TOKEN);
  const after    = { total: afterRes.total, with_img: (afterRes.deals||[]).filter(d => d.image_url).length };
  console.log(`   Target deals: ${after.total} | with_image now: ${after.with_img} | before: ${before.with_img}`);

  console.log('\n=== DONE ===');
  console.log(`Processed: ${deals.length} | Recovered images: ${updates.length} | Applied to DB: ${pushRes.applied || 0}`);
}

main().catch(e => { console.error(e); process.exit(1); });

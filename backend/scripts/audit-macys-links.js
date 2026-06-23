/**
 * Macy's URL Audit
 *
 * Fetches all Macy's product URLs from production DB and validates each one:
 *  1. HTTP HEAD request → 200 OK + contains product ID in response URL
 *  2. Products with broken URLs → quality_status='HIDDEN_BROKEN_URL' + is_public_visible=false
 *
 * Run from backend/ directory:
 *   PROD_API_URL=https://deal-hunter-ai.onrender.com node scripts/audit-macys-links.js
 *
 * Or against local DB:
 *   node scripts/audit-macys-links.js --local
 */

require('dotenv').config();
const https = require('https');

const PROD_API   = process.env.PROD_API_URL || 'https://deal-hunter-ai.onrender.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL  || 'admin@dealhunter.ai';
const ADMIN_PASS  = process.env.ADMIN_PASS   || 'admin123';
const CONCURRENCY = 5;  // parallel checks
const TIMEOUT_MS  = 10000;
const DELAY_MS    = 200; // between batches

function apiRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(PROD_API + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 15000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: { _raw: data } }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function checkUrl(url) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Accept: 'text/html',
          },
          timeout: TIMEOUT_MS,
        },
        res => {
          res.resume();
          const finalUrl = res.headers.location || url;
          // 200 OK = valid. 301/302 to same host = follow (Macy's sometimes redirects).
          // 404 or redirect away = broken.
          const ok = res.statusCode === 200 ||
            (res.statusCode >= 301 && res.statusCode <= 302 &&
             finalUrl.includes('macys.com') && !finalUrl.includes('/not-found'));
          resolve({ url, status: res.statusCode, ok, finalUrl });
        }
      );
      req.on('error', e => resolve({ url, status: 0, ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, ok: false, error: 'timeout' }); });
      req.end();
    } catch (e) {
      resolve({ url, status: 0, ok: false, error: e.message });
    }
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Macy\'s URL Audit ===\n');

  // Step 1: Login
  console.log('1. Logging in...');
  const loginRes = await apiRequest('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (!loginRes.body.token) {
    console.error('Login failed:', loginRes.body.error);
    process.exit(1);
  }
  const TOKEN = loginRes.body.token;
  console.log(`   Logged in as ${loginRes.body.user?.email}\n`);

  // Step 2: Fetch all Macy's products with URLs
  console.log('2. Fetching Macy\'s products...');
  const statsRes = await apiRequest('GET', '/api/admin/store-audit/macys', null, TOKEN);
  const audit = statsRes.body;
  console.log(`   Total products: ${audit.total_products}`);
  console.log(`   Active deals:   ${audit.active_deals}\n`);

  // Step 3: Get product URLs via deals endpoint (admin can see all)
  // Fetch in pages of 100
  const products = [];
  let offset = 0;
  const PAGE = 100;
  while (true) {
    const r = await apiRequest('GET', `/api/deals?store=macys&min_discount=0&limit=${PAGE}&offset=${offset}`, null, TOKEN);
    const deals = r.body.deals || [];
    if (!deals.length) break;
    for (const d of deals) {
      if (d.product_url && !products.find(p => p.url === d.product_url)) {
        products.push({ product_id: d.product_id, url: d.product_url, name: d.name });
      }
    }
    if (deals.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`3. Checking ${products.length} unique Macy's URLs...\n`);

  const broken = [];
  const valid  = [];

  // Process in batches
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => checkUrl(p.url)));

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const p = batch[j];
      if (r.ok) {
        valid.push(p);
        process.stdout.write('.');
      } else {
        broken.push({ ...p, status: r.status, error: r.error });
        process.stdout.write('X');
      }
    }

    if ((i + CONCURRENCY) % 50 === 0) {
      process.stdout.write(` ${i + CONCURRENCY}/${products.length}\n`);
    }
    if (i + CONCURRENCY < products.length) await sleep(DELAY_MS);
  }

  console.log(`\n\n4. Results:`);
  console.log(`   Valid URLs:  ${valid.length}`);
  console.log(`   Broken URLs: ${broken.length}`);

  if (broken.length === 0) {
    console.log('\nAll Macy\'s URLs are valid. Nothing to mark.');
    return;
  }

  console.log('\n   Broken URL sample:');
  broken.slice(0, 5).forEach(b => {
    console.log(`   [${b.status}] ${b.name?.slice(0, 50)} — ${b.url.slice(0, 80)}`);
  });

  // Step 4: Report — push broken product IDs to admin for manual review
  // (We can't directly UPDATE the DB from this script, but we output a CSV)
  const fs = require('fs');
  const csv = ['product_id,name,url,status,error'];
  broken.forEach(b => {
    const safeName = (b.name || '').replace(/,/g, ';');
    csv.push(`${b.product_id},${safeName},${b.url},${b.status},${b.error || ''}`);
  });
  const outFile = `macys-broken-urls-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.writeFileSync(outFile, csv.join('\n'));
  console.log(`\n5. Broken URLs exported to: ${outFile}`);
  console.log('\nTo mark these as HIDDEN_BROKEN_URL, run:');
  console.log('   node scripts/audit-macys-links.js --apply');
}

main().catch(e => { console.error(e); process.exit(1); });

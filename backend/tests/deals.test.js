/**
 * Deal Hunter AI — Backend Test Suite
 * Tests: Auth, Deals API, Opportunity Engine, Security
 */

const request = require('supertest');
const app = require('../src/index');

// ── Auth Tests ────────────────────────────────────────────────────────────────
describe('Auth API', () => {
  let token;

  test('POST /api/auth/register — creates new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test User', email: `test_${Date.now()}@example.com`, password: 'password123', zip_code: '77001' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.plan).toBe('free');
    token = res.body.token;
  });

  test('POST /api/auth/login — with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'demo@dealhunter.ai', password: 'user123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    token = res.body.token;
  });

  test('POST /api/auth/login — with invalid credentials returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad@example.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me — returns authenticated user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeTruthy();
  });

  test('GET /api/auth/me — without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── Deals API Tests ───────────────────────────────────────────────────────────
describe('Deals API', () => {
  let token;
  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'demo@dealhunter.ai', password: 'user123' });
    token = res.body.token;
  });

  test('GET /api/deals — returns deals list', async () => {
    const res = await request(app).get('/api/deals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deals)).toBe(true);
  });

  test('GET /api/deals?min_discount=50 — filters by discount', async () => {
    const res = await request(app).get('/api/deals?min_discount=50').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.deals.forEach(d => expect(parseFloat(d.discount_percent)).toBeGreaterThanOrEqual(50));
  });

  test('GET /api/deals/stats — returns stats object', async () => {
    const res = await request(app).get('/api/deals/stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_deals');
    expect(res.body).toHaveProperty('avg_discount');
  });

  test('GET /api/deals/:id — returns 404 for nonexistent deal', async () => {
    const res = await request(app).get('/api/deals/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── Health Check ──────────────────────────────────────────────────────────────
describe('Health', () => {
  test('GET /api/health — returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeTruthy();
  });
});

// ── Security Tests ────────────────────────────────────────────────────────────
describe('Security', () => {
  test('POST /api/auth/login — rate limits after 10 attempts', async () => {
    const promises = Array.from({ length: 12 }, () =>
      request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'wrong' })
    );
    const results = await Promise.all(promises);
    const rateLimited = results.some(r => r.status === 429);
    expect(rateLimited).toBe(true);
  });

  test('Requests without auth header get 401', async () => {
    const endpoints = ['/api/deals', '/api/alerts', '/api/watchlist'];
    for (const ep of endpoints) {
      const res = await request(app).get(ep);
      expect(res.status).toBe(401);
    }
  });
});

// ── Opportunity Engine Unit Tests ─────────────────────────────────────────────
describe('Opportunity Engine', () => {
  const { detectLiquidationType, detectFromPriceHistory } = require('../src/services/liquidationDetector');

  test('detectLiquidationType — identifies clearance from text', () => {
    const result = detectLiquidationType({ name: 'drill kit', description: '' }, { discountPercent: 40 }, 'clearance item');
    expect(result).not.toBeNull();
    expect(result.type).toBe('CLEARANCE');
    expect(result.confidence).toBe('HIGH');
  });

  test('detectLiquidationType — identifies price error at 70%+ discount', () => {
    const result = detectLiquidationType({ name: 'TV', description: '' }, { discountPercent: 75 }, '');
    expect(result).not.toBeNull();
    expect(result.type).toBe('PRICE_ERROR');
  });

  test('detectFromPriceHistory — detects aggressive markdown', () => {
    const history = [
      { current_price: 199 }, { current_price: 149 }, { current_price: 99 },
      { current_price: 69 }, { current_price: 49 },
    ];
    const result = detectFromPriceHistory(history);
    expect(result).not.toBeNull();
    expect(['AGGRESSIVE_MARKDOWN', 'MARKDOWN'].includes(result.type)).toBe(true);
  });

  test('detectFromPriceHistory — stable prices return null', () => {
    const history = [
      { current_price: 199 }, { current_price: 195 }, { current_price: 197 },
    ];
    const result = detectFromPriceHistory(history);
    expect(result).toBeNull();
  });
});

module.exports = {};

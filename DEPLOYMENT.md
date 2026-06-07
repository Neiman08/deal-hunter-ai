# Deal Hunter AI v3 — Production Deployment Guide

## Architecture Overview

```
[Users] → [Render Static Site (Frontend)]
              ↓
         [Render Web Service (Backend API)]
              ↓
    [Render PostgreSQL (Database)]
         ↓           ↓
  [Twilio]      [Stripe]
  (WhatsApp)  (Payments)
```

---

## 1. Database (Render PostgreSQL)

1. Create a **PostgreSQL** service on [render.com](https://render.com)
2. Copy the **Internal Database URL**
3. Set as `DATABASE_URL` environment variable

```bash
# Run migrations and seed
cd backend
DATABASE_URL=your_url npm run db:migrate
DATABASE_URL=your_url npm run db:seed
```

---

## 2. Backend (Render Web Service)

**Settings:**
- **Build Command:** `cd backend && npm install`
- **Start Command:** `cd backend && npm start`
- **Environment:** Node

**Required Environment Variables:**
```
DATABASE_URL=            # from Render PostgreSQL
JWT_SECRET=              # 32+ random chars (use: openssl rand -base64 32)
FRONTEND_URL=            # https://your-frontend.onrender.com
NODE_ENV=production
PORT=3001

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ELITE_PRICE_ID=price_...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+14155238886

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@yourdomain.com
SMTP_PASS=your_gmail_app_password
```

**Stripe Webhook:**
After deploying backend, add webhook endpoint in Stripe Dashboard:
```
https://your-backend.onrender.com/api/subscriptions/webhook
Events: checkout.session.completed, customer.subscription.deleted, invoice.payment_succeeded
```

---

## 3. Frontend (Render Static Site)

**Settings:**
- **Build Command:** `cd frontend && npm install && npm run build`
- **Publish Directory:** `frontend/dist`

**Required Environment Variables:**
```
VITE_API_URL=https://your-backend.onrender.com/api
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Update `frontend/src/utils/api.js`:
```javascript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});
```

---

## 4. Stripe Setup

### Create Products & Prices
1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Create **Pro Plan**: $19/month → copy `price_...` ID
3. Create **Elite Plan**: $49/month → copy `price_...` ID
4. Add both price IDs to backend env vars

### Configure Customer Portal
1. Stripe Dashboard → Settings → Billing → Customer Portal
2. Enable: Cancel subscription, Update payment method, View invoices

---

## 5. Twilio WhatsApp Setup

### Sandbox (Testing)
1. Sign up at [twilio.com](https://twilio.com)
2. Go to **Messaging → Try it out → Send a WhatsApp message**
3. Users must opt-in by texting the sandbox number first
4. WhatsApp Number: `+14155238886` (Twilio sandbox)

### Production (Business Approved)
1. Apply for **WhatsApp Business API** at twilio.com
2. Submit business verification (1-2 weeks)
3. Get dedicated WhatsApp number
4. Update `TWILIO_WHATSAPP_NUMBER` env var

---

## 6. Scalability Configuration

### Redis Caching (optional, high traffic)
```javascript
// Install: npm install redis
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });

// Cache deal listings for 5 minutes
async function getCachedDeals(key, fetchFn, ttl = 300) {
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);
  const data = await fetchFn();
  await client.setEx(key, ttl, JSON.stringify(data));
  return data;
}
```

### Database Connection Pooling
Current config: max 20 connections (handles ~500 concurrent users)
For 10,000+ users: upgrade Render PostgreSQL to "Standard" plan

### CDN for Static Assets
Add Cloudflare (free plan) in front of Render Static Site for:
- Global CDN
- DDoS protection
- Edge caching

---

## 7. Monitoring

### Health Check
```
GET https://your-backend.onrender.com/api/health
```

### Recommended Monitoring Stack
- **Uptime**: UptimeRobot (free, pings every 5 min)
- **Errors**: Sentry (free tier, catches backend exceptions)
- **Logs**: Render Dashboard → Logs tab
- **Metrics**: Render Dashboard → Metrics

---

## 8. Domain Setup

1. Buy domain (e.g., `dealhunter.ai`) on Namecheap/Cloudflare
2. In Render → your static site → Custom Domains → add domain
3. Point domain DNS to Render (they provide the CNAME)
4. SSL is automatic (Render provides free TLS)

---

## 9. Launch Checklist

- [ ] Database migrated and seeded
- [ ] Backend deployed and health check passing
- [ ] Frontend deployed and loading
- [ ] Stripe webhook registered and tested
- [ ] Test email alert (create alert, trigger scan)
- [ ] Test WhatsApp (sandbox opt-in, trigger scan)
- [ ] Test checkout flow (use Stripe test card `4242 4242 4242 4242`)
- [ ] Admin panel accessible at `/admin`
- [ ] Custom domain live with SSL
- [ ] Monitoring configured (UptimeRobot)

---

## 10. Estimated Monthly Costs at Launch

| Service | Free Tier | Paid |
|---------|-----------|------|
| Render Web Service | $0 (with cold starts) | $7/mo (always-on) |
| Render PostgreSQL | $0 (90 days) | $7/mo |
| Render Static Site | $0 | $0 |
| Twilio WhatsApp | $0 (sandbox) | $0.005/msg |
| Stripe | $0 | 2.9% + 30¢/transaction |
| Domain | — | $10-15/yr |
| **Total** | **$0** | **~$14/mo + Stripe fees** |

At 100 paying users ($19 avg): ~$1,400 MRR → $14/mo infra = 99% margin 🚀

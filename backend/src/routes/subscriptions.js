/**
 * Stripe Subscription Routes
 * Handles plan upgrades, webhook processing, and billing portal
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// Initialize Stripe (lazy — only if key exists)
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PLANS = {
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    amount: 1900, // cents
    features: ['Unlimited alerts', 'Map view', 'Resale calculator', 'Priority support'],
  },
  elite: {
    name: 'Elite',
    priceId: process.env.STRIPE_ELITE_PRICE_ID,
    amount: 4900,
    features: ['All Pro features', 'WhatsApp alerts', '1-hr early access', 'AI scoring', 'Multi-ZIP'],
  },
};

// GET /subscriptions/plans — public plan info
router.get('/plans', (req, res) => {
  res.json({ plans: PLANS });
});

// POST /subscriptions/checkout — create Stripe checkout session
router.post('/checkout', authenticate, async (req, res) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  try {
    const stripe = getStripe();
    const planConfig = PLANS[plan];

    // Create or retrieve Stripe customer
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: { userId: req.user.id, plan },
      });
      customerId = customer.id;
      await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/pricing?success=true&plan=${plan}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      metadata: { userId: req.user.id, plan },
      subscription_data: {
        metadata: { userId: req.user.id, plan },
        trial_period_days: plan === 'pro' ? 7 : 0, // 7-day trial for Pro
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    logger.error('Checkout error:', err.message);
    if (err.message === 'Stripe not configured') {
      // Demo mode — simulate successful upgrade
      await query('UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2', [plan, req.user.id]);
      return res.json({ url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pricing?success=true&plan=${plan}`, demo: true });
    }
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /subscriptions/portal — billing portal for plan management
router.post('/portal', authenticate, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!req.user.stripe_customer_id) return res.status(400).json({ error: 'No active subscription' });

    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/pricing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

// POST /subscriptions/webhook — Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const stripe = getStripe();
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, plan } = session.metadata;
        await query(`
          UPDATE users
          SET plan = $1, stripe_subscription_id = $2, plan_expires_at = NOW() + INTERVAL '1 month', updated_at = NOW()
          WHERE id = $3
        `, [plan, session.subscription, userId]);
        logger.info(`✅ Plan upgraded: user ${userId} → ${plan}`);
        break;
      }
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        const sub = event.data.object;
        await query(`
          UPDATE users SET plan = 'free', stripe_subscription_id = NULL, plan_expires_at = NULL, updated_at = NOW()
          WHERE stripe_subscription_id = $1
        `, [sub.id]);
        logger.info(`Plan downgraded for subscription ${sub.id}`);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await query(`
          UPDATE users SET plan_expires_at = NOW() + INTERVAL '1 month', updated_at = NOW()
          WHERE stripe_subscription_id = $1
        `, [invoice.subscription]);
        break;
      }
      case 'invoice.payment_failed': {
        logger.warn(`Payment failed for subscription ${event.data.object.subscription}`);
        break;
      }
    }
  } catch (err) {
    logger.error('Webhook processing error:', err.message);
  }

  res.json({ received: true });
});

// GET /subscriptions/status — current subscription status
router.get('/status', authenticate, async (req, res) => {
  try {
    const user = await query(
      'SELECT plan, plan_expires_at, stripe_customer_id, stripe_subscription_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const u = user.rows[0];
    res.json({
      plan: u.plan,
      expiresAt: u.plan_expires_at,
      hasActiveSubscription: u.plan !== 'free',
      canManageBilling: !!u.stripe_customer_id,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;

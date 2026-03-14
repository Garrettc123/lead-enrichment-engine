'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { PLANS, createCheckoutSession, constructWebhookEvent } = require('../services/billing');
const { authMiddleware } = require('../middleware/auth');
const { ApiKey } = require('../models');

// GET /api/v1/billing/plans
router.get('/v1/billing/plans', (req, res) => {
  res.json({
    plans: Object.entries(PLANS).map(([id, plan]) => ({
      id,
      name: plan.name,
      price_monthly: plan.price,
      enrichments_per_month: plan.monthly_enrichments === Infinity ? 'unlimited' : plan.monthly_enrichments,
      description: plan.description,
      subscribe_url: `/api/v1/billing/subscribe/${id}`,
    })),
  });
});

// POST /api/v1/billing/subscribe/:plan
router.post('/v1/billing/subscribe/:plan', async (req, res) => {
  const { plan } = req.params;
  const { email, success_url, cancel_url } = req.body;

  if (!PLANS[plan]) {
    return res.status(400).json({ error: `Unknown plan: ${plan}. Use: starter, growth, or scale` });
  }
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const session = await createCheckoutSession({ plan, email, successUrl: success_url, cancelUrl: cancel_url });
    res.json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    if (err.message === 'Stripe not configured' || err.message.startsWith('No Stripe price ID')) {
      // Return informational response when Stripe is not configured
      return res.json({
        message: 'Stripe not configured - set STRIPE_SECRET_KEY and STRIPE_PRICE_* to enable billing',
        plan: PLANS[plan],
        next_step: 'POST /api/v1/billing/generate-api-key to get an API key directly',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/billing/generate-api-key  (direct key provisioning without Stripe)
router.post('/v1/billing/generate-api-key', async (req, res) => {
  const { email, plan } = req.body;
  if (!email || !plan) {
    return res.status(400).json({ error: 'Email and plan required' });
  }
  if (!PLANS[plan]) {
    return res.status(400).json({ error: `Unknown plan: ${plan}` });
  }

  const key = `lek_${plan[0]}_${crypto.randomBytes(20).toString('hex')}`;
  try {
    const apiKey = await ApiKey.create({ key, email, plan, active: true });
    res.status(201).json({ api_key: apiKey.key, plan, email, created_at: apiKey.created_at });
  } catch {
    res.status(201).json({ api_key: key, plan, email, note: 'Database unavailable - save this key securely' });
  }
});

// POST /api/v1/billing/stripe-webhook  (raw body - applied in server.js before express.json)
router.post('/v1/billing/stripe-webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = constructWebhookEvent(req.body, sig);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { plan } = session.metadata || {};
        const email = session.customer_details?.email;
        if (email && plan && PLANS[plan]) {
          const key = `lek_${plan[0]}_${crypto.randomBytes(20).toString('hex')}`;
          await ApiKey.create({
            key, email, plan, active: true,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
          });
          console.log(`✅ New ${plan} subscriber: ${email}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await ApiKey.updateOne({ stripe_subscription_id: subscription.id }, { active: false });
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/v1/billing/usage
router.get('/v1/billing/usage', authMiddleware, (req, res) => {
  const limit = req.user.limit;
  res.json({
    plan: req.user.plan,
    usage_this_month: req.user.usage,
    limit: limit === Infinity ? 'unlimited' : limit,
    remaining: limit === Infinity ? 'unlimited' : Math.max(0, limit - req.user.usage),
  });
});

module.exports = router;

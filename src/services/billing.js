'use strict';

const PLANS = {
  starter: {
    name: 'Starter',
    price: 199,
    monthly_enrichments: 1000,
    description: '1,000 enrichments/month',
  },
  growth: {
    name: 'Growth',
    price: 599,
    monthly_enrichments: 10000,
    description: '10,000 enrichments/month',
  },
  scale: {
    name: 'Scale',
    price: 1999,
    monthly_enrichments: Infinity,
    description: 'Unlimited enrichments/month',
  },
};

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const Stripe = require('stripe');
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

async function createCheckoutSession({ plan, email, successUrl, cancelUrl }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error(`Unknown plan: ${plan}`);

  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
  if (!priceId) throw new Error(`No Stripe price ID configured for plan: ${plan}`);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${process.env.APP_URL || 'http://localhost:3000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${process.env.APP_URL || 'http://localhost:3000'}/billing/cancel`,
    metadata: { plan },
  });
}

function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { PLANS, getStripe, createCheckoutSession, constructWebhookEvent };

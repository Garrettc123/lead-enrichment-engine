'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { connectDB } = require('./models');
const { initQueue } = require('./services/queue');
const { apiLimiter, strictLimiter } = require('./middleware/rateLimit');
const { constructWebhookEvent } = require('./services/billing');
const { ApiKey } = require('./models');
const crypto = require('crypto');
const { PLANS } = require('./services/billing');

const enrichRoutes = require('./routes/enrich');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers (allow CDN scripts for dashboard)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));

// CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*';
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'] }));

// Stripe webhook requires raw body - must be registered BEFORE express.json()
app.post('/api/v1/billing/stripe-webhook', express.raw({ type: 'application/json' }), strictLimiter, async (req, res) => {
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
          await ApiKey.create({ key, email, plan, active: true, stripe_customer_id: session.customer, stripe_subscription_id: session.subscription });
          console.log(`✅ New ${plan} subscriber: ${email}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        await ApiKey.updateOne({ stripe_subscription_id: event.data.object.id }, { active: false });
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Body parsing for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging (skip in tests)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Rate limiting on all /api/ routes
app.use('/api/', apiLimiter);

// Mount routes
app.use('/api', enrichRoutes);
app.use('/api', billingRoutes);
app.use('/api', webhookRoutes);
app.use(dashboardRoutes);

// Root info
app.get('/', (req, res) => {
  res.json({
    service: 'Lead Enrichment Engine',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      enrich: 'POST /api/enrich',
      enrich_v1: 'POST /api/v1/enrich',
      batch: 'POST /api/v1/batch-enrich',
      job_status: 'GET /api/v1/jobs/:id',
      stats: 'GET /api/v1/stats',
      plans: 'GET /api/v1/billing/plans',
      subscribe: 'POST /api/v1/billing/subscribe/:plan',
      generate_key: 'POST /api/v1/billing/generate-api-key',
      usage: 'GET /api/v1/billing/usage',
      webhooks: 'POST /api/v1/webhooks',
      dashboard: 'GET /dashboard',
    },
    pricing: {
      starter: { price: '$199/month', enrichments: '1,000/month' },
      growth: { price: '$599/month', enrichments: '10,000/month' },
      scale: { price: '$1,999/month', enrichments: 'unlimited' },
    },
  });
});

// Health check
app.get('/health', (req, res) => {
  const { isConnected } = require('./models');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    db: isConnected() ? 'connected' : 'disconnected',
    version: '1.0.0',
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  await connectDB(process.env.MONGODB_URI);
  initQueue(process.env.REDIS_URL);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Lead Enrichment Engine running on port ${PORT}`);
    console.log(`💰 Pricing: Starter $199 | Growth $599 | Scale $1,999/month`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📖 API Docs: http://localhost:${PORT}/`);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;


'use strict';

const request = require('supertest');

// Mock all external services before requiring app
jest.mock('../src/models', () => ({
  connectDB: jest.fn().mockResolvedValue(false),
  isConnected: jest.fn().mockReturnValue(false),
  incrementStats: jest.fn().mockResolvedValue(undefined),
  getStats: jest.fn().mockResolvedValue({
    enrichments_today: 42,
    revenue_today: 0,
    monthly_revenue: 2990,
    enrichments_this_month: 150,
  }),
  ApiKey: {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ key: 'lek_s_abc123', plan: 'starter', created_at: new Date() }),
    updateOne: jest.fn().mockResolvedValue({}),
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  },
  Webhook: {
    create: jest.fn().mockImplementation(data => Promise.resolve({
      _id: 'whid1',
      url: data.url,
      events: data.events || ['enrichment.complete', 'batch.complete'],
      created_at: new Date(),
    })),
    find: jest.fn().mockResolvedValue([]),
    findByIdAndDelete: jest.fn().mockResolvedValue({ _id: 'whid1' }),
  },
  Lead: { create: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../src/services/queue', () => ({
  initQueue: jest.fn().mockReturnValue(null),
  enqueueJob: jest.fn().mockResolvedValue({
    jobId: 'test-job-123',
    status: 'completed',
    results: [
      { success: true, input: { email: 'test@example.com' }, profile: {} },
      { success: true, input: { email: 'other@example.com' }, profile: {} },
    ],
  }),
  getJobStatus: jest.fn().mockResolvedValue(null),
}));

const mockProfile = {
  email: 'test@example.com',
  first_name: 'John',
  last_name: 'Smith',
  title: 'Software Engineer',
  company: { name: 'Example', domain: 'example.com', industry: null, size: null, location: null },
  contact: { linkedin: null, twitter: null, phone: null },
  technographics: [],
  intent_signals: { hiring: false, recent_funding: false, tech_stack_changes: false },
  confidence_score: 0.3,
  data_coverage_pct: 0,
  sources_used: [],
  enriched_at: new Date().toISOString(),
};

jest.mock('../src/services/enrichment', () => ({
  enrichFromInput: jest.fn().mockResolvedValue(mockProfile),
}));

jest.mock('../src/services/billing', () => ({
  PLANS: {
    starter: { name: 'Starter', price: 199, monthly_enrichments: 1000, description: '1,000 enrichments/month' },
    growth: { name: 'Growth', price: 599, monthly_enrichments: 10000, description: '10,000 enrichments/month' },
    scale: { name: 'Scale', price: 1999, monthly_enrichments: Infinity, description: 'Unlimited enrichments/month' },
  },
  getStripe: jest.fn().mockReturnValue(null),
  createCheckoutSession: jest.fn().mockRejectedValue(new Error('Stripe not configured')),
  constructWebhookEvent: jest.fn().mockImplementation(() => { throw new Error('Stripe not configured'); }),
}));

const app = require('../src/server');

beforeAll(() => {
  process.env.ADMIN_API_KEY = 'test-admin-key-secret';
});

afterAll(() => {
  delete process.env.ADMIN_API_KEY;
});

describe('GET /', () => {
  it('returns service info with pricing', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body.service).toBe('Lead Enrichment Engine');
    expect(res.body.pricing.starter.price).toBe('$199/month');
    expect(res.body.pricing.growth.price).toBe('$599/month');
    expect(res.body.pricing.scale.price).toBe('$1,999/month');
    expect(res.body.endpoints.enrich).toBeDefined();
    expect(res.body.endpoints.dashboard).toBeDefined();
  });
});

describe('GET /health', () => {
  it('returns healthy status', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.db).toBe('disconnected');
  });
});

describe('POST /api/enrich (new endpoint)', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).post('/api/enrich').send({ email: 'test@example.com' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/API key/i);
  });

  it('returns enriched profile with admin API key', async () => {
    const res = await request(app)
      .post('/api/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ email: 'test@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('test@example.com');
    expect(res.body.confidence_score).toBeDefined();
    expect(res.body.processing_time_ms).toBeDefined();
  });

  it('accepts domain as input', async () => {
    const res = await request(app)
      .post('/api/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ domain: 'acme.com' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts company name as input', async () => {
    const res = await request(app)
      .post('/api/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ company: 'Salesforce' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Provide at least one/);
  });

  it('returns 400 for malformed email', async () => {
    const res = await request(app)
      .post('/api/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ email: 'not-a-valid-email' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });
});

describe('POST /api/v1/enrich (backward-compatible)', () => {
  it('enriches by email (legacy format)', async () => {
    const res = await request(app)
      .post('/api/v1/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ email: 'john@acme.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body.enriched_at).toBeDefined();
  });

  it('enriches by domain', async () => {
    const res = await request(app)
      .post('/api/v1/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ domain: 'acme.com' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for empty input', async () => {
    const res = await request(app)
      .post('/api/v1/enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({});
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/batch-enrich', () => {
  it('processes batch using emails array (legacy)', async () => {
    const res = await request(app)
      .post('/api/v1/batch-enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ emails: ['test@example.com', 'other@example.com'] });
    expect(res.statusCode).toBe(200);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBeDefined();
  });

  it('processes batch using leads array (new format)', async () => {
    const res = await request(app)
      .post('/api/v1/batch-enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ leads: [{ email: 'a@a.com' }, { domain: 'b.com' }] });
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toBeDefined();
  });

  it('accepts optional webhook_url', async () => {
    const res = await request(app)
      .post('/api/v1/batch-enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ emails: ['test@example.com'], webhook_url: 'https://example.com/hook' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for missing batch data', async () => {
    const res = await request(app)
      .post('/api/v1/batch-enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for empty emails array', async () => {
    const res = await request(app)
      .post('/api/v1/batch-enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ emails: [] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for batch over 1000', async () => {
    const emails = Array(1001).fill('test@example.com');
    const res = await request(app)
      .post('/api/v1/batch-enrich')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ emails });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Max 1000/);
  });
});

describe('GET /api/v1/stats', () => {
  it('returns real stats with source status', async () => {
    const res = await request(app).get('/api/v1/stats');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('enrichments_today');
    expect(res.body).toHaveProperty('top_sources');
    expect(Array.isArray(res.body.top_sources)).toBe(true);
    expect(res.body.top_sources[0]).toHaveProperty('enabled');
  });
});

describe('GET /api/v1/billing/plans', () => {
  it('returns all three pricing plans', async () => {
    const res = await request(app).get('/api/v1/billing/plans');
    expect(res.statusCode).toBe(200);
    expect(res.body.plans).toHaveLength(3);

    const starter = res.body.plans.find(p => p.id === 'starter');
    expect(starter).toBeDefined();
    expect(starter.price_monthly).toBe(199);
    expect(starter.enrichments_per_month).toBe(1000);

    const growth = res.body.plans.find(p => p.id === 'growth');
    expect(growth.price_monthly).toBe(599);
    expect(growth.enrichments_per_month).toBe(10000);

    const scale = res.body.plans.find(p => p.id === 'scale');
    expect(scale.price_monthly).toBe(1999);
    expect(scale.enrichments_per_month).toBe('unlimited');
  });
});

describe('POST /api/v1/billing/subscribe/:plan', () => {
  it('responds when Stripe not configured', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe/starter')
      .send({ email: 'test@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/Stripe not configured/i);
  });

  it('returns 400 for unknown plan', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe/enterprise')
      .send({ email: 'test@example.com' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/v1/billing/subscribe/starter').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Email/i);
  });
});

describe('GET /dashboard', () => {
  it('serves dashboard HTML page', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Lead Enrichment Engine');
  });
});

describe('GET /api/v1/dashboard/stats', () => {
  it('returns dashboard stats with coverage', async () => {
    const res = await request(app).get('/api/v1/dashboard/stats');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('data_coverage_pct');
    expect(res.body).toHaveProperty('active_sources');
    expect(res.body).toHaveProperty('total_sources');
    expect(res.body).toHaveProperty('db_connected');
    expect(Array.isArray(res.body.sources)).toBe(true);
  });
});

describe('POST /api/v1/webhooks', () => {
  it('registers a webhook with valid URL', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ url: 'https://example.com/webhook' });
    expect(res.statusCode).toBe(201);
    expect(res.body.url).toBe('https://example.com/webhook');
    expect(res.body.secret).toBeDefined();
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid URL', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('X-API-Key', 'test-admin-key-secret')
      .send({ url: 'not-a-url' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/webhooks', () => {
  it('lists webhooks for authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/webhooks')
      .set('X-API-Key', 'test-admin-key-secret');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.webhooks)).toBe(true);
  });
});

describe('GET /api/v1/billing/usage', () => {
  it('returns usage info for authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('X-API-Key', 'test-admin-key-secret');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('plan');
    expect(res.body).toHaveProperty('usage_this_month');
    expect(res.body).toHaveProperty('limit');
  });
});

describe('404 handling', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/not-a-real-route');
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

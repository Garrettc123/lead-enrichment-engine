'use strict';

const router = require('express').Router();
const { enrichFromInput } = require('../services/enrichment');
const { enqueueJob, getJobStatus } = require('../services/queue');
const { authMiddleware, trackUsage } = require('../middleware/auth');
const { incrementStats, getStats } = require('../models');

function validateInput(body) {
  const { email, domain, company, first_name } = body;
  if (!email && !domain && !company && !first_name) {
    return 'Provide at least one of: email, domain, company, or first_name';
  }
  if (email && !email.includes('@')) {
    return 'Invalid email format';
  }
  return null;
}

// POST /api/enrich  (new simplified endpoint)
router.post('/enrich', authMiddleware, async (req, res) => {
  const err = validateInput(req.body);
  if (err) return res.status(400).json({ error: err });

  const startTime = Date.now();
  try {
    const profile = await enrichFromInput(req.body);
    await incrementStats(1);
    if (req.apiKey) await trackUsage(req.apiKey._id);
    res.json({ ...profile, processing_time_ms: Date.now() - startTime });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Enrichment failed', message: error.message });
  }
});

// POST /api/v1/enrich  (backward-compatible endpoint)
router.post('/v1/enrich', authMiddleware, async (req, res) => {
  const input = req.body;
  const err = validateInput(input);
  if (err) return res.status(400).json({ error: err });

  const startTime = Date.now();
  try {
    const profile = await enrichFromInput(input);
    await incrementStats(1);
    if (req.apiKey) await trackUsage(req.apiKey._id);
    res.json({ ...profile, processing_time_ms: Date.now() - startTime });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Enrichment failed', message: error.message });
  }
});

// POST /api/v1/batch-enrich
router.post('/v1/batch-enrich', authMiddleware, async (req, res) => {
  const { leads, emails, webhook_url } = req.body;

  // Support both 'leads' array (objects) and legacy 'emails' array (strings)
  let inputs;
  if (Array.isArray(leads) && leads.length > 0) {
    inputs = leads;
  } else if (Array.isArray(emails) && emails.length > 0) {
    inputs = emails.map(email => ({ email }));
  } else {
    return res.status(400).json({
      error: 'Provide a non-empty leads array (objects with email/domain/company) or emails array',
    });
  }

  if (inputs.length > 1000) {
    return res.status(400).json({ error: 'Max 1000 leads per batch' });
  }

  // Check remaining quota
  if (req.user && req.user.limit !== Infinity) {
    const remaining = req.user.limit - req.user.usage;
    if (inputs.length > remaining) {
      return res.status(429).json({
        error: `Batch size (${inputs.length}) exceeds remaining monthly quota (${remaining})`,
        upgrade_url: '/api/v1/billing/plans',
      });
    }
  }

  try {
    const result = await enqueueJob(inputs, webhook_url || null);
    if (result.status === 'completed') {
      const successCount = result.results.filter(r => r.success).length;
      await incrementStats(successCount);
      if (req.apiKey) await trackUsage(req.apiKey._id, successCount);
    }
    res.json(result);
  } catch (error) {
    console.error('Batch enrichment error:', error);
    res.status(500).json({ error: 'Batch enrichment failed', message: error.message });
  }
});

// GET /api/v1/jobs/:id  - Check async batch job status
router.get('/v1/jobs/:id', authMiddleware, async (req, res) => {
  const status = await getJobStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

// GET /api/v1/stats
router.get('/v1/stats', async (req, res) => {
  const stats = await getStats();
  res.json({
    ...stats,
    top_sources: [
      { name: 'Clearbit', enabled: !!process.env.CLEARBIT_API_KEY },
      { name: 'Hunter.io', enabled: !!process.env.HUNTER_API_KEY },
      { name: 'Apollo', enabled: !!process.env.APOLLO_API_KEY },
      { name: 'GitHub', enabled: !!process.env.GITHUB_TOKEN },
      { name: 'Crunchbase', enabled: !!process.env.CRUNCHBASE_API_KEY },
      { name: 'Twitter/X', enabled: !!process.env.TWITTER_BEARER_TOKEN },
      { name: 'News', enabled: !!process.env.NEWS_API_KEY },
      { name: 'BuiltWith', enabled: !!process.env.BUILTWITH_API_KEY },
    ],
  });
});

module.exports = router;

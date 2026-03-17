'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { Webhook } = require('../models');

// POST /api/v1/webhooks  - Register a webhook endpoint
router.post('/v1/webhooks', authMiddleware, async (req, res) => {
  const { url, events } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Webhook URL required' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook URL' });
  }

  const secret = `whsec_${crypto.randomBytes(20).toString('hex')}`;

  try {
    const webhook = await Webhook.create({
      url,
      api_key_id: req.apiKey?._id,
      events: Array.isArray(events) ? events : ['enrichment.complete', 'batch.complete'],
      secret,
      active: true,
    });
    res.status(201).json({
      id: webhook._id,
      url: webhook.url,
      events: webhook.events,
      secret,
      created_at: webhook.created_at,
      note: 'Save the secret - it will not be shown again. Use it to verify incoming webhook signatures.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register webhook', message: err.message });
  }
});

// GET /api/v1/webhooks  - List registered webhooks
router.get('/v1/webhooks', authMiddleware, async (req, res) => {
  try {
    const webhooks = await Webhook.find({ api_key_id: req.apiKey?._id }, { secret: 0 });
    res.json({ webhooks });
  } catch {
    res.json({ webhooks: [] });
  }
});

// DELETE /api/v1/webhooks/:id  - Remove a webhook
router.delete('/v1/webhooks/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Webhook.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

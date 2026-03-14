'use strict';

const { ApiKey } = require('../models');

const PLAN_LIMITS = {
  starter: 1000,
  growth: 10000,
  scale: Infinity,
};

async function authMiddleware(req, res, next) {
  // Only accept API key from header (not query param) to avoid leaking in logs/URLs
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      help: 'Add X-API-Key header. Get a key at /api/v1/billing/plans',
    });
  }

  // Admin key bypasses all limits
  if (process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY) {
    req.user = { plan: 'scale', usage: 0, limit: Infinity };
    return next();
  }

  try {
    const key = await ApiKey.findOne({ key: apiKey, active: true });
    if (!key) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    const limit = PLAN_LIMITS[key.plan] || PLAN_LIMITS.starter;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthlyUsage = key.usage_by_month?.get?.(currentMonth) || 0;

    if (limit !== Infinity && monthlyUsage >= limit) {
      return res.status(429).json({
        error: 'Monthly enrichment limit reached',
        plan: key.plan,
        limit,
        usage: monthlyUsage,
        upgrade_url: '/api/v1/billing/plans',
      });
    }

    req.apiKey = key;
    req.user = { id: key._id, plan: key.plan, usage: monthlyUsage, limit };
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    // Graceful degradation - allow request through on DB error
    req.user = { plan: 'scale', usage: 0, limit: Infinity };
    next();
  }
}

async function trackUsage(apiKeyId, count = 1) {
  if (!apiKeyId) return;
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    await ApiKey.findByIdAndUpdate(apiKeyId, {
      $inc: { [`usage_by_month.${currentMonth}`]: count },
    });
  } catch (err) {
    console.error('Usage tracking error:', err.message);
  }
}

module.exports = { authMiddleware, trackUsage };

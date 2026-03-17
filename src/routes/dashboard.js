'use strict';

const router = require('express').Router();
const path = require('path');
const { apiLimiter } = require('../middleware/rateLimit');
const { getStats, isConnected } = require('../models');

// GET /dashboard  - Serve the HTML dashboard (rate limited)
router.get('/dashboard', apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

// GET /api/v1/dashboard/stats  - Dashboard data (JSON)
router.get('/api/v1/dashboard/stats', async (req, res) => {
  try {
    const stats = await getStats();

    const sources = [
      { name: 'Clearbit', env: 'CLEARBIT_API_KEY' },
      { name: 'Hunter.io', env: 'HUNTER_API_KEY' },
      { name: 'Apollo', env: 'APOLLO_API_KEY' },
      { name: 'GitHub', env: 'GITHUB_TOKEN' },
      { name: 'Crunchbase', env: 'CRUNCHBASE_API_KEY' },
      { name: 'Twitter/X', env: 'TWITTER_BEARER_TOKEN' },
      { name: 'News', env: 'NEWS_API_KEY' },
      { name: 'BuiltWith', env: 'BUILTWITH_API_KEY' },
    ];
    const activeSources = sources.filter(s => !!process.env[s.env]);
    const data_coverage_pct = Math.round((activeSources.length / sources.length) * 100);

    res.json({
      ...stats,
      data_coverage_pct,
      active_sources: activeSources.length,
      total_sources: sources.length,
      sources: sources.map(s => ({ name: s.name, active: !!process.env[s.env] })),
      db_connected: isConnected(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

module.exports = router;

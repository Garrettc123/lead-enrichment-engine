'use strict';

const mongoose = require('mongoose');

function isConnected() {
  return mongoose.connection.readyState === 1;
}

const leadSchema = new mongoose.Schema({
  email: { type: String, index: true },
  domain: String,
  company: String,
  profile: mongoose.Schema.Types.Mixed,
  api_key_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey' },
  created_at: { type: Date, default: Date.now },
});

const apiKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  name: String,
  email: String,
  plan: { type: String, enum: ['starter', 'growth', 'scale'], default: 'starter' },
  active: { type: Boolean, default: true },
  stripe_customer_id: String,
  stripe_subscription_id: String,
  usage_by_month: { type: Map, of: Number, default: {} },
  created_at: { type: Date, default: Date.now },
});

const webhookSchema = new mongoose.Schema({
  url: { type: String, required: true },
  api_key_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey' },
  events: { type: [String], default: ['enrichment.complete', 'batch.complete'] },
  active: { type: Boolean, default: true },
  secret: String,
  created_at: { type: Date, default: Date.now },
});

const statsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true },
  enrichments: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
});

const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
const ApiKey = mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema);
const Webhook = mongoose.models.Webhook || mongoose.model('Webhook', webhookSchema);
const Stats = mongoose.models.Stats || mongoose.model('Stats', statsSchema);

async function connectDB(uri) {
  if (!uri) {
    console.log('⚠️  No MONGODB_URI set - running without database persistence');
    return false;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ MongoDB connected');
    return true;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    return false;
  }
}

// In-memory fallback stats
const memStats = { enrichments_today: 0, revenue_today: 0, monthly_revenue: 0, enrichments_this_month: 0 };

async function incrementStats(count = 1, revenue = 0) {
  memStats.enrichments_today += count;
  memStats.revenue_today += revenue;
  memStats.monthly_revenue += revenue;
  memStats.enrichments_this_month += count;

  if (!isConnected()) return;

  const today = new Date().toISOString().slice(0, 10);
  try {
    await Stats.findOneAndUpdate({ date: today }, { $inc: { enrichments: count, revenue } }, { upsert: true });
  } catch (err) {
    console.error('Stats update error:', err.message);
  }
}

async function getStats() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7);

  if (!isConnected()) {
    return {
      enrichments_today: memStats.enrichments_today,
      revenue_today: memStats.revenue_today,
      monthly_revenue: memStats.monthly_revenue,
      enrichments_this_month: memStats.enrichments_this_month,
    };
  }

  try {
    const [todayStats, monthStats] = await Promise.all([
      Stats.findOne({ date: today }),
      Stats.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: null, total_enrichments: { $sum: '$enrichments' }, total_revenue: { $sum: '$revenue' } } },
      ]),
    ]);
    return {
      enrichments_today: todayStats?.enrichments || 0,
      revenue_today: todayStats?.revenue || 0,
      monthly_revenue: monthStats[0]?.total_revenue || 0,
      enrichments_this_month: monthStats[0]?.total_enrichments || 0,
    };
  } catch {
    return {
      enrichments_today: memStats.enrichments_today,
      revenue_today: memStats.revenue_today,
      monthly_revenue: memStats.monthly_revenue,
      enrichments_this_month: memStats.enrichments_this_month,
    };
  }
}

module.exports = { Lead, ApiKey, Webhook, Stats, connectDB, incrementStats, getStats, isConnected };

'use strict';

const Queue = require('bull');
const axios = require('axios');

let enrichmentQueue = null;

function initQueue(redisUrl) {
  if (!redisUrl) {
    console.log('⚠️  No REDIS_URL set - batch jobs will be processed synchronously');
    return null;
  }
  try {
    const queue = new Queue('enrichment', redisUrl);

    queue.process(async (job) => {
      const { enrichFromInput } = require('./enrichment');
      const { incrementStats } = require('../models');
      const { inputs, webhookUrl, jobId } = job.data;
      const results = [];

      for (const input of inputs) {
        try {
          const profile = await enrichFromInput(input);
          results.push({ success: true, input, profile });
        } catch (err) {
          results.push({ success: false, input, error: err.message });
        }
        await job.progress(Math.round((results.length / inputs.length) * 100));
      }

      await incrementStats(results.filter(r => r.success).length);

      if (webhookUrl) {
        await fireWebhook(webhookUrl, { event: 'batch.complete', jobId, results });
      }
      return results;
    });

    queue.on('error', err => console.error('Queue error:', err.message));
    console.log('✅ Redis queue initialized');
    return queue;
  } catch (err) {
    console.error('❌ Queue initialization failed:', err.message);
    return null;
  }
}

async function fireWebhook(url, payload) {
  try {
    await axios.post(url, payload, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'LeadEnrichmentEngine/1.0' },
    });
  } catch (err) {
    console.error(`Webhook delivery failed to ${url}:`, err.message);
  }
}

async function enqueueJob(inputs, webhookUrl = null) {
  const { enrichFromInput } = require('./enrichment');
  const { incrementStats } = require('../models');

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (!enrichmentQueue) {
    // Synchronous fallback when Redis is unavailable
    const results = await Promise.all(
      inputs.map(async input => {
        try {
          const profile = await enrichFromInput(input);
          return { success: true, input, profile };
        } catch (err) {
          return { success: false, input, error: err.message };
        }
      })
    );

    await incrementStats(results.filter(r => r.success).length);

    if (webhookUrl) {
      setImmediate(() => fireWebhook(webhookUrl, { event: 'batch.complete', jobId, results }));
    }
    return { jobId, status: 'completed', results };
  }

  const job = await enrichmentQueue.add(
    { inputs, webhookUrl, jobId },
    { attempts: 2, backoff: { type: 'exponential', delay: 2000 } }
  );
  return {
    jobId: String(job.id),
    status: 'queued',
    estimated_time_seconds: inputs.length * 2,
  };
}

async function getJobStatus(jobId) {
  if (!enrichmentQueue) return null;
  try {
    const job = await enrichmentQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return { jobId, status: state, progress: job._progress, result: job.returnvalue };
  } catch {
    return null;
  }
}

function getQueue() {
  return enrichmentQueue;
}

function setQueue(q) {
  enrichmentQueue = q;
}

module.exports = { initQueue, enqueueJob, getJobStatus, fireWebhook, getQueue, setQueue };

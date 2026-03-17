'use strict';

const axios = require('axios');

async function safeCall(name, fn) {
  try {
    return await fn();
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[${name}] source error: ${err.message}`);
    }
    return null;
  }
}

// Clearbit - person and company enrichment
async function clearbitEnrich({ email, domain }) {
  const key = process.env.CLEARBIT_API_KEY;
  if (!key) return null;
  return safeCall('clearbit', async () => {
    const auth = { auth: { username: key, password: '' }, timeout: 6000 };
    if (email) {
      const { data } = await axios.get(
        `https://person-stream.clearbit.com/v2/combined/find?email=${encodeURIComponent(email)}`,
        auth
      );
      return { source: 'clearbit', person: data.person || null, company: data.company || null };
    }
    if (domain) {
      const { data } = await axios.get(
        `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(domain)}`,
        auth
      );
      return { source: 'clearbit', person: null, company: data };
    }
    return null;
  });
}

// Hunter.io - email verification and domain search
async function hunterEnrich({ email, domain }) {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  return safeCall('hunter', async () => {
    if (email) {
      const { data } = await axios.get(
        `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`,
        { timeout: 6000 }
      );
      return { source: 'hunter', email_data: data.data || null };
    }
    if (domain) {
      const { data } = await axios.get(
        `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${key}&limit=5`,
        { timeout: 6000 }
      );
      return { source: 'hunter', domain_data: data.data || null };
    }
    return null;
  });
}

// Apollo.io - B2B person and company data
async function apolloEnrich({ email, domain, first_name, last_name, organization_name }) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;
  return safeCall('apollo', async () => {
    const payload = { api_key: key };
    if (email) payload.email = email;
    if (first_name) payload.first_name = first_name;
    if (last_name) payload.last_name = last_name;
    if (organization_name) payload.organization_name = organization_name;
    if (domain) payload.domain = domain;
    const { data } = await axios.post(
      'https://api.apollo.io/v1/people/match',
      payload,
      { timeout: 6000, headers: { 'Content-Type': 'application/json' } }
    );
    return { source: 'apollo', person: data.person || null, organization: data.organization || null };
  });
}

// GitHub - org and user profiles
async function githubEnrich({ email, domain, company }) {
  const token = process.env.GITHUB_TOKEN;
  const headers = token ? { Authorization: `token ${token}` } : {};
  const orgName = domain ? domain.split('.')[0] : (company ? company.split(' ')[0].toLowerCase() : null);
  if (!orgName) return null;
  return safeCall('github', async () => {
    try {
      const { data } = await axios.get(
        `https://api.github.com/orgs/${encodeURIComponent(orgName)}`,
        { headers, timeout: 6000 }
      );
      return {
        source: 'github',
        github_org: {
          login: data.login,
          name: data.name,
          description: data.description,
          url: data.html_url,
          public_repos: data.public_repos,
          followers: data.followers,
          location: data.location,
          blog: data.blog,
          email: data.email,
          twitter_username: data.twitter_username,
        },
      };
    } catch {
      if (!email) return null;
      const { data } = await axios.get(
        `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
        { headers, timeout: 6000 }
      );
      if (!data.total_count) return null;
      const user = data.items[0];
      return {
        source: 'github',
        github_user: { login: user.login, name: user.name, url: user.html_url, avatar: user.avatar_url },
      };
    }
  });
}

// Crunchbase - startup funding and company data
async function crunchbaseEnrich({ domain, company }) {
  const key = process.env.CRUNCHBASE_API_KEY;
  if (!key) return null;
  const searchTerm = company || (domain ? domain.split('.')[0] : null);
  if (!searchTerm) return null;
  return safeCall('crunchbase', async () => {
    const { data } = await axios.post(
      `https://api.crunchbase.com/api/v4/searches/organizations?user_key=${key}`,
      {
        field_ids: ['short_description', 'funding_total', 'num_employees_enum',
          'founded_on', 'last_funding_type', 'website_url'],
        query: [{ type: 'predicate', field_id: 'facet_ids', operator_id: 'includes', values: ['company'] }],
        limit: 1,
      },
      { timeout: 8000 }
    );
    const org = data.entities?.[0]?.properties;
    if (!org) return null;
    return {
      source: 'crunchbase',
      funding: org.funding_total?.value_usd || null,
      last_funding_type: org.last_funding_type || null,
      founded: org.founded_on?.value || null,
      description: org.short_description || null,
    };
  });
}

// Twitter/X - social profile
async function twitterEnrich({ domain, company }) {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return null;
  const handle = company ? company.replace(/\s+/g, '').toLowerCase() : (domain ? domain.split('.')[0] : null);
  if (!handle) return null;
  return safeCall('twitter', async () => {
    const { data } = await axios.get(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=description,public_metrics,location,url`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 6000 }
    );
    const user = data.data;
    if (!user) return null;
    return {
      source: 'twitter',
      twitter: {
        handle: user.username,
        name: user.name,
        description: user.description,
        followers: user.public_metrics?.followers_count,
        following: user.public_metrics?.following_count,
        tweets: user.public_metrics?.tweet_count,
        location: user.location,
        url: user.url,
      },
    };
  });
}

// NewsAPI - recent company mentions
async function newsEnrich({ company, domain }) {
  const key = process.env.NEWS_API_KEY;
  if (!key) return null;
  const query = company || domain;
  if (!query) return null;
  return safeCall('news', async () => {
    const { data } = await axios.get(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=5&apiKey=${key}`,
      { timeout: 6000 }
    );
    return {
      source: 'news',
      recent_mentions: (data.articles || []).map(a => ({
        title: a.title,
        source: a.source?.name,
        url: a.url,
        published_at: a.publishedAt,
      })),
    };
  });
}

// BuiltWith - tech stack detection
async function techstackEnrich({ domain }) {
  const key = process.env.BUILTWITH_API_KEY;
  if (!key || !domain) return null;
  return safeCall('builtwith', async () => {
    const { data } = await axios.get(
      `https://api.builtwith.com/v21/api.json?KEY=${key}&LOOKUP=${encodeURIComponent(domain)}`,
      { timeout: 8000 }
    );
    const techs = data.Results?.[0]?.Result?.Paths?.[0]?.Technologies || [];
    return {
      source: 'builtwith',
      tech_stack: techs.slice(0, 20).map(t => ({
        name: t.Name,
        category: t.Categories?.[0],
        first_detected: t.FirstDetected,
      })),
    };
  });
}

module.exports = {
  clearbitEnrich,
  hunterEnrich,
  apolloEnrich,
  githubEnrich,
  crunchbaseEnrich,
  twitterEnrich,
  newsEnrich,
  techstackEnrich,
};

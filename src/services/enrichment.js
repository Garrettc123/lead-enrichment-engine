'use strict';

const {
  clearbitEnrich,
  hunterEnrich,
  apolloEnrich,
  githubEnrich,
  crunchbaseEnrich,
  twitterEnrich,
  newsEnrich,
  techstackEnrich,
} = require('./sources');

function extractDomain(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

function domainToCompany(domain) {
  if (!domain) return null;
  const name = domain.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function calculateCoverage(profile) {
  const checks = [
    profile.first_name,
    profile.last_name,
    profile.title,
    profile.company && profile.company.name,
    profile.company && profile.company.industry,
    profile.company && profile.company.size,
    profile.company && profile.company.location,
    profile.company && profile.company.founded,
    profile.contact && profile.contact.phone,
    profile.contact && profile.contact.linkedin,
    profile.contact && profile.contact.twitter,
    profile.technographics && profile.technographics.length > 0,
    profile.intent_signals && (profile.intent_signals.hiring || profile.intent_signals.recent_funding),
    profile.social && profile.social.github,
    profile.funding && profile.funding.total,
  ];
  const filled = checks.filter(v => v !== null && v !== undefined && v !== false && v !== '').length;
  return Math.round((filled / checks.length) * 100);
}

function mergeProfile(input, sources) {
  const { email, domain, company, first_name, last_name } = input;
  const resolvedDomain = domain || extractDomain(email);
  const resolvedCompany = company || domainToCompany(resolvedDomain);

  // Track whether the company name came from a real data source (more reliable than domain-derived)
  let companyNameFromSource = false;

  const profile = {
    email: email || null,
    first_name: first_name || null,
    last_name: last_name || null,
    title: null,
    company: {
      name: company || null,  // start with only user-provided; API sources fill in, domain-derived is fallback
      domain: resolvedDomain || null,
      industry: null,
      size: null,
      revenue: null,
      location: null,
      founded: null,
      employees: null,
      description: null,
      website: resolvedDomain ? `https://${resolvedDomain}` : null,
      emails_found: null,
    },
    contact: {
      phone: null,
      linkedin: null,
      twitter: null,
    },
    email_verified: null,
    email_score: null,
    social: {
      github: null,
      twitter: null,
    },
    technographics: [],
    intent_signals: {
      hiring: false,
      recent_funding: false,
      tech_stack_changes: false,
      website_traffic_trend: null,
    },
    funding: {
      total: null,
      last_round: null,
    },
    news_mentions: [],
    sources_used: [],
    confidence_score: 0,
    data_coverage_pct: 0,
    enriched_at: new Date().toISOString(),
  };

  // Clearbit
  const clearbit = sources.find(s => s && s.source === 'clearbit');
  if (clearbit) {
    profile.sources_used.push('clearbit');
    if (clearbit.person) {
      profile.first_name = profile.first_name || clearbit.person.name?.givenName || null;
      profile.last_name = profile.last_name || clearbit.person.name?.familyName || null;
      profile.title = clearbit.person.employment?.title || null;
      if (clearbit.person.linkedin?.handle) {
        profile.contact.linkedin = `linkedin.com/in/${clearbit.person.linkedin.handle}`;
      }
      if (clearbit.person.twitter?.handle) {
        profile.contact.twitter = `@${clearbit.person.twitter.handle}`;
      }
      profile.contact.phone = clearbit.person.phone || null;
    }
    if (clearbit.company) {
      if (clearbit.company.name) {
        profile.company.name = clearbit.company.name;
        companyNameFromSource = true;
      }
      profile.company.industry = clearbit.company.category?.industry || null;
      profile.company.size = clearbit.company.metrics?.employeesRange || null;
      profile.company.location = clearbit.company.location || null;
      profile.company.founded = clearbit.company.foundedYear || null;
      profile.company.employees = clearbit.company.metrics?.employees || null;
      profile.company.revenue = clearbit.company.metrics?.annualRevenue || null;
      profile.company.description = clearbit.company.description || null;
      if (Array.isArray(clearbit.company.tech) && clearbit.company.tech.length > 0) {
        profile.technographics = clearbit.company.tech;
      }
    }
  }

  // Apollo
  const apollo = sources.find(s => s && s.source === 'apollo');
  if (apollo) {
    profile.sources_used.push('apollo');
    if (apollo.person) {
      profile.first_name = profile.first_name || apollo.person.first_name || null;
      profile.last_name = profile.last_name || apollo.person.last_name || null;
      profile.title = profile.title || apollo.person.title || null;
      if (!profile.contact.linkedin && apollo.person.linkedin_url) {
        profile.contact.linkedin = apollo.person.linkedin_url.replace('https://', '');
      }
      profile.contact.phone = profile.contact.phone || apollo.person.phone_numbers?.[0]?.sanitized_number || null;
    }
    if (apollo.organization) {
      // Apollo org name is authoritative if no higher-priority source set it
      if (!companyNameFromSource && apollo.organization.name) {
        profile.company.name = apollo.organization.name;
        companyNameFromSource = true;
      }
      profile.company.industry = profile.company.industry || apollo.organization.industry || null;
      if (!profile.company.size && apollo.organization.estimated_num_employees) {
        profile.company.size = String(apollo.organization.estimated_num_employees);
      }
      if (!profile.company.location) {
        const parts = [apollo.organization.city, apollo.organization.country].filter(Boolean);
        profile.company.location = parts.join(', ') || null;
      }
    }
  }

  // Hunter
  const hunter = sources.find(s => s && s.source === 'hunter');
  if (hunter) {
    profile.sources_used.push('hunter');
    if (hunter.email_data) {
      profile.email_verified = hunter.email_data.result === 'deliverable';
      profile.email_score = hunter.email_data.score || null;
    }
    if (hunter.domain_data) {
      profile.company.emails_found = hunter.domain_data.emails?.length || 0;
    }
  }

  // GitHub
  const github = sources.find(s => s && s.source === 'github');
  if (github) {
    profile.sources_used.push('github');
    if (github.github_org) {
      profile.social.github = github.github_org.url || null;
      profile.company.location = profile.company.location || github.github_org.location || null;
    }
    if (github.github_user) {
      profile.social.github = github.github_user.url || null;
    }
  }

  // Crunchbase
  const crunchbase = sources.find(s => s && s.source === 'crunchbase');
  if (crunchbase) {
    profile.sources_used.push('crunchbase');
    profile.funding.total = crunchbase.funding || null;
    profile.funding.last_round = crunchbase.last_funding_type || null;
    profile.intent_signals.recent_funding = !!crunchbase.funding;
    profile.company.founded = profile.company.founded || crunchbase.founded || null;
    profile.company.description = profile.company.description || crunchbase.description || null;
  }

  // Twitter
  const twitter = sources.find(s => s && s.source === 'twitter');
  if (twitter) {
    profile.sources_used.push('twitter');
    profile.social.twitter = twitter.twitter || null;
    if (!profile.contact.twitter && twitter.twitter?.handle) {
      profile.contact.twitter = `@${twitter.twitter.handle}`;
    }
  }

  // News
  const news = sources.find(s => s && s.source === 'news');
  if (news) {
    profile.sources_used.push('news');
    profile.news_mentions = news.recent_mentions || [];
    if (!profile.intent_signals.recent_funding) {
      profile.intent_signals.recent_funding = profile.news_mentions.some(m =>
        m.title && (m.title.toLowerCase().includes('funding') || m.title.toLowerCase().includes('raises'))
      );
    }
  }

  // BuiltWith tech stack
  const builtwith = sources.find(s => s && s.source === 'builtwith');
  if (builtwith && builtwith.tech_stack && builtwith.tech_stack.length > 0) {
    profile.sources_used.push('builtwith');
    profile.technographics = builtwith.tech_stack.map(t => t.name).filter(Boolean);
  }

  // Fallback: if no source set the company name, use domain-derived
  if (!profile.company.name) {
    profile.company.name = resolvedCompany || null;
  }

  profile.data_coverage_pct = calculateCoverage(profile);
  profile.confidence_score = parseFloat(
    Math.min(0.99, 0.3 + (profile.data_coverage_pct / 100) * 0.69).toFixed(2)
  );

  return profile;
}

async function enrichFromInput(input) {
  const { email, domain, company, first_name } = input;

  if (!email && !domain && !company && !first_name) {
    throw new Error('Provide at least one of: email, domain, company, or first_name');
  }

  if (email && !email.includes('@')) {
    throw new Error('Invalid email format');
  }

  const resolvedDomain = domain || extractDomain(email);

  const sourceResults = await Promise.all([
    clearbitEnrich({ email, domain: resolvedDomain }),
    hunterEnrich({ email, domain: resolvedDomain }),
    apolloEnrich({ email, domain: resolvedDomain, first_name, last_name: input.last_name, organization_name: company }),
    githubEnrich({ email, domain: resolvedDomain, company }),
    crunchbaseEnrich({ domain: resolvedDomain, company }),
    twitterEnrich({ domain: resolvedDomain, company }),
    newsEnrich({ company, domain: resolvedDomain }),
    techstackEnrich({ domain: resolvedDomain }),
  ]);

  return mergeProfile(input, sourceResults.filter(Boolean));
}

module.exports = { enrichFromInput, calculateCoverage, mergeProfile, extractDomain };

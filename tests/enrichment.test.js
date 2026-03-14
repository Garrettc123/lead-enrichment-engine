'use strict';

// Mock all data sources before loading enrichment module
jest.mock('../src/services/sources', () => ({
  clearbitEnrich: jest.fn().mockResolvedValue(null),
  hunterEnrich: jest.fn().mockResolvedValue(null),
  apolloEnrich: jest.fn().mockResolvedValue(null),
  githubEnrich: jest.fn().mockResolvedValue(null),
  crunchbaseEnrich: jest.fn().mockResolvedValue(null),
  twitterEnrich: jest.fn().mockResolvedValue(null),
  newsEnrich: jest.fn().mockResolvedValue(null),
  techstackEnrich: jest.fn().mockResolvedValue(null),
}));

const { enrichFromInput, calculateCoverage, extractDomain, mergeProfile } = require('../src/services/enrichment');
const sources = require('../src/services/sources');

beforeEach(() => {
  jest.clearAllMocks();
  // Default: all sources return null
  Object.values(sources).forEach(fn => fn.mockResolvedValue(null));
});

describe('extractDomain', () => {
  it('extracts domain from valid email', () => {
    expect(extractDomain('john@acme.com')).toBe('acme.com');
    expect(extractDomain('user@subdomain.example.org')).toBe('subdomain.example.org');
  });

  it('returns null for email without @', () => {
    expect(extractDomain('notanemail')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain(undefined)).toBeNull();
    expect(extractDomain('')).toBeNull();
  });
});

describe('enrichFromInput - input validation', () => {
  it('throws when no input provided', async () => {
    await expect(enrichFromInput({})).rejects.toThrow('Provide at least one of');
  });

  it('throws for malformed email', async () => {
    await expect(enrichFromInput({ email: 'not-an-email' })).rejects.toThrow('Invalid email format');
  });
});

describe('enrichFromInput - profile structure', () => {
  it('builds correct profile from email', async () => {
    const profile = await enrichFromInput({ email: 'john@acme.com' });

    expect(profile.email).toBe('john@acme.com');
    expect(profile.company.domain).toBe('acme.com');
    expect(profile.company.name).toBe('Acme');
    expect(profile.enriched_at).toBeDefined();
    expect(typeof profile.confidence_score).toBe('number');
    expect(profile.confidence_score).toBeGreaterThanOrEqual(0);
    expect(profile.confidence_score).toBeLessThanOrEqual(1);
    expect(Array.isArray(profile.sources_used)).toBe(true);
    expect(Array.isArray(profile.technographics)).toBe(true);
    expect(Array.isArray(profile.news_mentions)).toBe(true);
  });

  it('builds profile from domain only', async () => {
    const profile = await enrichFromInput({ domain: 'stripe.com' });
    expect(profile.company.domain).toBe('stripe.com');
    expect(profile.company.name).toBe('Stripe');
    expect(profile.company.website).toBe('https://stripe.com');
  });

  it('builds profile from company name only', async () => {
    const profile = await enrichFromInput({ company: 'Salesforce' });
    expect(profile.company.name).toBe('Salesforce');
  });

  it('builds profile from first_name only', async () => {
    const profile = await enrichFromInput({ first_name: 'Jane' });
    expect(profile.first_name).toBe('Jane');
  });

  it('includes all required top-level fields', async () => {
    const profile = await enrichFromInput({ email: 'test@example.com' });
    expect(profile).toHaveProperty('email');
    expect(profile).toHaveProperty('company');
    expect(profile).toHaveProperty('contact');
    expect(profile).toHaveProperty('social');
    expect(profile).toHaveProperty('technographics');
    expect(profile).toHaveProperty('intent_signals');
    expect(profile).toHaveProperty('funding');
    expect(profile).toHaveProperty('news_mentions');
    expect(profile).toHaveProperty('sources_used');
    expect(profile).toHaveProperty('confidence_score');
    expect(profile).toHaveProperty('data_coverage_pct');
    expect(profile).toHaveProperty('enriched_at');
  });
});

describe('enrichFromInput - Clearbit merging', () => {
  it('merges person data from Clearbit', async () => {
    sources.clearbitEnrich.mockResolvedValue({
      source: 'clearbit',
      person: {
        name: { givenName: 'Jane', familyName: 'Doe' },
        employment: { title: 'CTO' },
        linkedin: { handle: 'jane-doe' },
        twitter: { handle: 'janedoe' },
        phone: '+1-415-555-1234',
      },
      company: null,
    });

    const profile = await enrichFromInput({ email: 'jane@acme.com' });
    expect(profile.first_name).toBe('Jane');
    expect(profile.last_name).toBe('Doe');
    expect(profile.title).toBe('CTO');
    expect(profile.contact.linkedin).toBe('linkedin.com/in/jane-doe');
    expect(profile.contact.twitter).toBe('@janedoe');
    expect(profile.contact.phone).toBe('+1-415-555-1234');
    expect(profile.sources_used).toContain('clearbit');
  });

  it('merges company data from Clearbit', async () => {
    sources.clearbitEnrich.mockResolvedValue({
      source: 'clearbit',
      person: null,
      company: {
        name: 'Acme Corp',
        category: { industry: 'Software' },
        metrics: { employeesRange: '201-500', employees: 350, annualRevenue: 10000000 },
        location: 'San Francisco, CA',
        foundedYear: 2010,
        description: 'B2B software company',
        tech: ['Salesforce', 'AWS'],
      },
    });

    const profile = await enrichFromInput({ email: 'user@acme.com' });
    expect(profile.company.name).toBe('Acme Corp');
    expect(profile.company.industry).toBe('Software');
    expect(profile.company.size).toBe('201-500');
    expect(profile.company.location).toBe('San Francisco, CA');
    expect(profile.company.founded).toBe(2010);
    expect(profile.technographics).toEqual(['Salesforce', 'AWS']);
    expect(profile.sources_used).toContain('clearbit');
  });
});

describe('enrichFromInput - Apollo merging', () => {
  it('merges person and org data from Apollo', async () => {
    sources.apolloEnrich.mockResolvedValue({
      source: 'apollo',
      person: {
        first_name: 'Bob',
        last_name: 'Jones',
        title: 'VP Sales',
        linkedin_url: 'https://linkedin.com/in/bobjones',
        phone_numbers: [{ sanitized_number: '+14155551234' }],
      },
      organization: {
        name: 'Widgets Inc',
        industry: 'Manufacturing',
        estimated_num_employees: 500,
        city: 'Austin',
        country: 'US',
      },
    });

    const profile = await enrichFromInput({ email: 'bob@widgets.com' });
    expect(profile.first_name).toBe('Bob');
    expect(profile.last_name).toBe('Jones');
    expect(profile.title).toBe('VP Sales');
    expect(profile.contact.linkedin).toBe('linkedin.com/in/bobjones');
    expect(profile.contact.phone).toBe('+14155551234');
    expect(profile.company.name).toBe('Widgets Inc');
    expect(profile.sources_used).toContain('apollo');
  });
});

describe('enrichFromInput - GitHub merging', () => {
  it('merges GitHub org data', async () => {
    sources.githubEnrich.mockResolvedValue({
      source: 'github',
      github_org: {
        login: 'acme',
        name: 'Acme',
        url: 'https://github.com/acme',
        location: 'San Francisco',
      },
    });

    const profile = await enrichFromInput({ domain: 'acme.com' });
    expect(profile.social.github).toBe('https://github.com/acme');
    expect(profile.company.location).toBe('San Francisco');
    expect(profile.sources_used).toContain('github');
  });
});

describe('enrichFromInput - Crunchbase merging', () => {
  it('merges funding data from Crunchbase', async () => {
    sources.crunchbaseEnrich.mockResolvedValue({
      source: 'crunchbase',
      funding: 5000000,
      last_funding_type: 'Series A',
      founded: '2018-01-15',
      description: 'AI-powered analytics platform',
    });

    const profile = await enrichFromInput({ company: 'DataCo' });
    expect(profile.funding.total).toBe(5000000);
    expect(profile.funding.last_round).toBe('Series A');
    expect(profile.intent_signals.recent_funding).toBe(true);
    expect(profile.sources_used).toContain('crunchbase');
  });
});

describe('enrichFromInput - News merging', () => {
  it('detects recent funding from news', async () => {
    sources.newsEnrich.mockResolvedValue({
      source: 'news',
      recent_mentions: [
        { title: 'Acme raises $10M Series B funding', source: 'TechCrunch', url: 'https://tc.com/1', published_at: '2024-01-01' },
        { title: 'Acme launches new product', source: 'Forbes', url: 'https://forbes.com/1', published_at: '2024-01-02' },
      ],
    });

    const profile = await enrichFromInput({ company: 'Acme' });
    expect(profile.news_mentions).toHaveLength(2);
    expect(profile.intent_signals.recent_funding).toBe(true);
    expect(profile.sources_used).toContain('news');
  });
});

describe('enrichFromInput - Twitter merging', () => {
  it('merges Twitter/X social data', async () => {
    sources.twitterEnrich.mockResolvedValue({
      source: 'twitter',
      twitter: { handle: 'acmeinc', name: 'Acme Inc', description: 'We make widgets', followers: 5000 },
    });

    const profile = await enrichFromInput({ domain: 'acme.com' });
    expect(profile.social.twitter).toBeDefined();
    expect(profile.contact.twitter).toBe('@acmeinc');
    expect(profile.sources_used).toContain('twitter');
  });
});

describe('enrichFromInput - BuiltWith tech stack', () => {
  it('merges tech stack from BuiltWith', async () => {
    sources.techstackEnrich.mockResolvedValue({
      source: 'builtwith',
      tech_stack: [
        { name: 'React', category: 'JavaScript Frameworks' },
        { name: 'Stripe', category: 'Payment' },
        { name: 'AWS CloudFront', category: 'CDN' },
      ],
    });

    const profile = await enrichFromInput({ domain: 'acme.com' });
    expect(profile.technographics).toEqual(['React', 'Stripe', 'AWS CloudFront']);
    expect(profile.sources_used).toContain('builtwith');
  });
});

describe('enrichFromInput - multi-source merging', () => {
  it('aggregates data from multiple sources', async () => {
    sources.clearbitEnrich.mockResolvedValue({
      source: 'clearbit',
      person: { name: { givenName: 'Alice', familyName: 'Wong' }, employment: { title: 'CEO' }, linkedin: null, twitter: null },
      company: { name: 'AlphaCo', category: { industry: 'FinTech' }, metrics: {}, location: 'NYC' },
    });
    sources.githubEnrich.mockResolvedValue({
      source: 'github',
      github_org: { url: 'https://github.com/alphaco', location: null },
    });
    sources.crunchbaseEnrich.mockResolvedValue({
      source: 'crunchbase',
      funding: 2000000,
      last_funding_type: 'Seed',
      founded: '2020-03-01',
      description: 'FinTech startup',
    });

    const profile = await enrichFromInput({ email: 'alice@alphaco.com' });
    expect(profile.first_name).toBe('Alice');
    expect(profile.company.name).toBe('AlphaCo');
    expect(profile.funding.total).toBe(2000000);
    expect(profile.social.github).toBe('https://github.com/alphaco');
    expect(profile.sources_used).toContain('clearbit');
    expect(profile.sources_used).toContain('github');
    expect(profile.sources_used).toContain('crunchbase');
    expect(profile.confidence_score).toBeGreaterThan(0.3);
    expect(profile.data_coverage_pct).toBeGreaterThan(0);
  });
});

describe('calculateCoverage', () => {
  it('returns 0 for completely empty profile', () => {
    const pct = calculateCoverage({ company: {}, contact: {}, technographics: [], social: {}, funding: {}, intent_signals: {} });
    expect(pct).toBe(0);
  });

  it('returns higher percentage for populated profile', () => {
    const profile = {
      first_name: 'Alice',
      last_name: 'Smith',
      title: 'CEO',
      company: { name: 'Acme', industry: 'Software', size: '50-200', location: 'NYC', founded: 2015 },
      contact: { phone: '555-1234', linkedin: 'linkedin.com/in/alice', twitter: '@alice' },
      technographics: ['AWS', 'Stripe'],
      intent_signals: { hiring: true },
      social: { github: 'https://github.com/alice' },
      funding: { total: 1000000 },
    };
    expect(calculateCoverage(profile)).toBeGreaterThan(50);
  });

  it('confidence score increases with coverage', async () => {
    const lowProfile = await enrichFromInput({ email: 'x@x.com' });
    expect(lowProfile.confidence_score).toBeGreaterThanOrEqual(0.3);
    expect(lowProfile.confidence_score).toBeLessThanOrEqual(0.99);
  });
});

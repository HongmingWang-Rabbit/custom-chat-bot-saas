/**
 * Test Data Constants
 *
 * Matches the seed-database.ts script.
 * Run `npm run seed` before tests to ensure this data exists.
 */

// =============================================================================
// Configuration Constants
// =============================================================================

export const DEFAULT_BASE_URL = 'http://localhost:3000';

export const TIMEOUTS = {
  /** Default wait timeout for elements */
  default: 10000,
  /** Extended timeout for page loads */
  pageLoad: 30000,
  /** Timeout for streaming LLM responses */
  streaming: 60000,
  /** Timeout for network operations */
  network: 30000,
} as const;

// =============================================================================
// Test Data
// =============================================================================

export const TEST_TENANT = {
  slug: 'demo-company',
  name: 'Demo Company Inc.',
} as const;

export const SEEDED_DOCUMENTS = [
  {
    title: 'Q3 2024 Earnings Report',
    docType: 'report',
    fileName: 'q3-2024-earnings-report.txt',
  },
  {
    title: 'Risk Factors Disclosure',
    docType: 'disclosure',
    fileName: 'risk-factors-disclosure.txt',
  },
  {
    title: 'Company FAQ',
    docType: 'faq',
    fileName: 'company-faq.txt',
  },
  {
    title: 'Corporate Governance',
    docType: 'filing',
    fileName: 'corporate-governance.txt',
  },
] as const;

/**
 * Sample questions for Q&A testing.
 * These should match content in the seeded documents.
 */
export const SAMPLE_QUESTIONS = {
  // Should return earnings info with citations
  earnings: 'What was the Q3 2024 revenue?',
  // Should return FAQ info
  faq: 'When was Demo Company founded?',
  // Should return risk info
  risks: 'What are the main risks?',
  // Should return governance info
  governance: 'Who is on the board of directors?',
  // Low relevance - may return no context
  irrelevant: 'What is the weather today?',
  // Greeting - conversational
  greeting: 'Hello',
} as const;

/**
 * Expected snippets in answers for verification.
 */
export const EXPECTED_ANSWERS = {
  earnings: ['$150 million', '25%', 'revenue'],
  faq: ['2015', 'Jane Smith', 'John Doe'],
  risks: ['competition', 'market', 'cybersecurity'],
  governance: ['board', 'directors', 'independent'],
} as const;

/**
 * Routes for navigation testing.
 */
export const ROUTES = {
  landing: '/',
  admin: {
    dashboard: '/admin',
    tenants: '/admin/tenants',
    tenantSettings: (slug: string) => `/admin/tenants/${slug}`,
    documents: '/admin/documents',
    review: '/admin/review',
  },
  demo: (slug: string) => `/demo/${slug}`,
} as const;

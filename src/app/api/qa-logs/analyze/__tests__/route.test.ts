/**
 * Tests for Q&A Logs Analyze API Route
 *
 * POST /api/qa-logs/analyze
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// =============================================================================
// Mocks
// =============================================================================

// Mock LLM adapter
const mockComplete = vi.fn();

vi.mock('@/lib/llm', () => ({
  createLLMAdapterFromConfig: () => ({
    complete: mockComplete,
  }),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// =============================================================================
// Test Fixtures
// =============================================================================

const validLogs = [
  {
    id: 'log-1',
    question: 'What is the revenue?',
    answer: 'Revenue is $4.2B',
    confidence: 0.85,
    flagged: false,
  },
  {
    id: 'log-2',
    question: 'What are the risks?',
    answer: 'Key risks include market volatility.',
    confidence: 0.72,
    flagged: false,
  },
];

const validAnalysisResponse = {
  topTopics: ['Revenue', 'Risks', 'Growth'],
  userConcerns: ['Financial performance', 'Market conditions'],
  attentionNeeded: [
    { logId: 'log-1', reason: 'Could be more detailed', priority: 'low' },
  ],
  overallInsights: 'Users are primarily interested in financial metrics.',
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/qa-logs/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default successful LLM response
  mockComplete.mockResolvedValue({
    content: JSON.stringify(validAnalysisResponse),
    usage: { totalTokens: 1500 },
  });
});

// =============================================================================
// Tests: Request Validation
// =============================================================================

describe('POST /api/qa-logs/analyze - Request Validation', () => {
  it('should return 400 for invalid JSON body', async () => {
    const request = new NextRequest('http://localhost/api/qa-logs/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_JSON');
  });

  it('should return 400 when tenantSlug is missing', async () => {
    const request = createRequest({ logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_PARAMS');
  });

  it('should return 400 when tenantSlug is empty', async () => {
    const request = createRequest({ tenantSlug: '', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_PARAMS');
  });

  it('should return 400 when logs array is missing', async () => {
    const request = createRequest({ tenantSlug: 'test-tenant' });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_PARAMS');
  });

  it('should return 400 when logs array is empty', async () => {
    const request = createRequest({ tenantSlug: 'test-tenant', logs: [] });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_PARAMS');
  });

  it('should return 400 when logs exceed max limit', async () => {
    const tooManyLogs = Array(101)
      .fill(null)
      .map((_, i) => ({
        id: `log-${i}`,
        question: 'Test?',
        answer: 'Test',
        confidence: 0.5,
        flagged: false,
      }));

    const request = createRequest({ tenantSlug: 'test-tenant', logs: tooManyLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_PARAMS');
  });

  it('should return 400 for invalid log structure', async () => {
    const invalidLogs = [{ id: 'log-1' }]; // missing required fields

    const request = createRequest({ tenantSlug: 'test-tenant', logs: invalidLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_PARAMS');
  });
});

// =============================================================================
// Tests: Successful Analysis
// =============================================================================

describe('POST /api/qa-logs/analyze - Successful Analysis', () => {
  it('should return analysis for valid request', async () => {
    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual(validAnalysisResponse);
    expect(data.tokensUsed).toBe(1500);
  });

  it('should calculate correct stats', async () => {
    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(data.stats.totalAnalyzed).toBe(2);
    expect(data.stats.avgConfidence).toBeCloseTo((0.85 + 0.72) / 2);
    expect(data.stats.lowConfidenceCount).toBe(0); // both >= 0.5
    expect(data.stats.flaggedCount).toBe(0);
  });

  it('should count low confidence logs correctly', async () => {
    const logsWithLowConfidence = [
      { ...validLogs[0], confidence: 0.3 },
      { ...validLogs[1], confidence: 0.4 },
    ];

    const request = createRequest({
      tenantSlug: 'test-tenant',
      logs: logsWithLowConfidence,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.stats.lowConfidenceCount).toBe(2);
  });

  it('should count flagged logs correctly', async () => {
    const logsWithFlags = [
      { ...validLogs[0], flagged: true },
      { ...validLogs[1], flagged: true },
    ];

    const request = createRequest({
      tenantSlug: 'test-tenant',
      logs: logsWithFlags,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.stats.flaggedCount).toBe(2);
  });

  it('should call LLM with correct parameters', async () => {
    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    await POST(request);

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [messages, options] = mockComplete.mock.calls[0];

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('2 Q&A interaction logs');
    expect(options.temperature).toBe(0.3);
    expect(options.maxTokens).toBe(2000);
  });

  it('should limit logs to MAX_LOGS_TO_ANALYZE (50)', async () => {
    const manyLogs = Array(75)
      .fill(null)
      .map((_, i) => ({
        id: `log-${i}`,
        question: `Question ${i}?`,
        answer: `Answer ${i}`,
        confidence: 0.5,
        flagged: false,
      }));

    const request = createRequest({ tenantSlug: 'test-tenant', logs: manyLogs });

    const response = await POST(request);
    const data = await response.json();

    // Stats should only reflect the first 50 logs
    expect(data.stats.totalAnalyzed).toBe(50);
  });
});

// =============================================================================
// Tests: LLM Response Handling
// =============================================================================

describe('POST /api/qa-logs/analyze - LLM Response Handling', () => {
  it('should handle JSON wrapped in markdown code blocks', async () => {
    mockComplete.mockResolvedValue({
      content: '```json\n' + JSON.stringify(validAnalysisResponse) + '\n```',
      usage: { totalTokens: 1500 },
    });

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual(validAnalysisResponse);
  });

  it('should handle JSON wrapped in plain code blocks', async () => {
    mockComplete.mockResolvedValue({
      content: '```\n' + JSON.stringify(validAnalysisResponse) + '\n```',
      usage: { totalTokens: 1500 },
    });

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual(validAnalysisResponse);
  });

  it('should handle JSON with leading/trailing whitespace', async () => {
    mockComplete.mockResolvedValue({
      content: '\n\n  ' + JSON.stringify(validAnalysisResponse) + '  \n\n',
      usage: { totalTokens: 1500 },
    });

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual(validAnalysisResponse);
  });

  it('should provide defaults for missing optional fields', async () => {
    mockComplete.mockResolvedValue({
      content: JSON.stringify({ overallInsights: 'Summary only' }),
      usage: { totalTokens: 500 },
    });

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.topTopics).toEqual([]);
    expect(data.summary.userConcerns).toEqual([]);
    expect(data.summary.attentionNeeded).toEqual([]);
    expect(data.summary.overallInsights).toBe('Summary only');
  });

  it('should return 500 for invalid JSON from LLM', async () => {
    mockComplete.mockResolvedValue({
      content: 'This is not valid JSON at all',
      usage: { totalTokens: 100 },
    });

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe('PARSE_ERROR');
  });

  it('should return 500 for invalid schema from LLM', async () => {
    mockComplete.mockResolvedValue({
      content: JSON.stringify({
        attentionNeeded: [{ logId: 'test', reason: 'test', priority: 'invalid' }],
      }),
      usage: { totalTokens: 100 },
    });

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe('PARSE_ERROR');
  });
});

// =============================================================================
// Tests: Error Handling
// =============================================================================

describe('POST /api/qa-logs/analyze - Error Handling', () => {
  it('should return 500 when LLM call fails', async () => {
    mockComplete.mockRejectedValue(new Error('LLM API error'));

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe('ANALYSIS_ERROR');
  });

  it('should handle LLM timeout gracefully', async () => {
    mockComplete.mockRejectedValue(new Error('Request timeout'));

    const request = createRequest({ tenantSlug: 'test-tenant', logs: validLogs });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe('ANALYSIS_ERROR');
    expect(data.error).toBe('Analysis failed');
  });
});

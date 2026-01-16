/**
 * Tests for Q&A log analysis prompts and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  analysisResultSchema,
  MAX_ANSWER_PREVIEW_LENGTH,
  MAX_LOGS_TO_ANALYZE,
  AnalysisLog,
} from '../analysis-prompts';

// =============================================================================
// Test Fixtures
// =============================================================================

const sampleLog: AnalysisLog = {
  id: 'log-123',
  question: 'What was the revenue last quarter?',
  answer: 'The revenue was $4.2 billion last quarter.',
  confidence: 0.85,
  flagged: false,
};

const flaggedLog: AnalysisLog = {
  id: 'log-456',
  question: 'What is the CEO salary?',
  answer: 'I could not find information about CEO compensation.',
  confidence: 0.25,
  flagged: true,
};

const longAnswerLog: AnalysisLog = {
  id: 'log-789',
  question: 'Describe the company strategy',
  answer: 'A'.repeat(500), // 500 characters
  confidence: 0.65,
  flagged: false,
};

// =============================================================================
// Tests: Constants
// =============================================================================

describe('analysis-prompts constants', () => {
  it('should have correct MAX_ANSWER_PREVIEW_LENGTH', () => {
    expect(MAX_ANSWER_PREVIEW_LENGTH).toBe(300);
  });

  it('should have correct MAX_LOGS_TO_ANALYZE', () => {
    expect(MAX_LOGS_TO_ANALYZE).toBe(50);
  });
});

// =============================================================================
// Tests: System Prompt
// =============================================================================

describe('buildAnalysisSystemPrompt', () => {
  it('should return a non-empty string', () => {
    const prompt = buildAnalysisSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('should include JSON format instructions', () => {
    const prompt = buildAnalysisSystemPrompt();
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('topTopics');
    expect(prompt).toContain('userConcerns');
    expect(prompt).toContain('attentionNeeded');
    expect(prompt).toContain('overallInsights');
  });

  it('should include priority guidelines', () => {
    const prompt = buildAnalysisSystemPrompt();
    expect(prompt).toContain('HIGH');
    expect(prompt).toContain('MEDIUM');
    expect(prompt).toContain('LOW');
  });

  it('should include analysis requirements', () => {
    const prompt = buildAnalysisSystemPrompt();
    expect(prompt).toContain('3-5');
    expect(prompt).toContain('topics');
    expect(prompt).toContain('concerned');
  });
});

// =============================================================================
// Tests: User Prompt
// =============================================================================

describe('buildAnalysisUserPrompt', () => {
  it('should handle a single log', () => {
    const prompt = buildAnalysisUserPrompt([sampleLog]);
    expect(prompt).toContain('1 Q&A interaction logs');
    expect(prompt).toContain('log-123');
    expect(prompt).toContain('What was the revenue last quarter?');
    expect(prompt).toContain('85%');
    expect(prompt).toContain('Flagged: No');
  });

  it('should handle multiple logs', () => {
    const prompt = buildAnalysisUserPrompt([sampleLog, flaggedLog]);
    expect(prompt).toContain('2 Q&A interaction logs');
    expect(prompt).toContain('log-123');
    expect(prompt).toContain('log-456');
    expect(prompt).toContain('---'); // separator
  });

  it('should format flagged logs correctly', () => {
    const prompt = buildAnalysisUserPrompt([flaggedLog]);
    expect(prompt).toContain('Flagged: Yes');
    expect(prompt).toContain('25%');
  });

  it('should truncate long answers', () => {
    const prompt = buildAnalysisUserPrompt([longAnswerLog]);
    expect(prompt).toContain('...');
    // Should not contain the full 500 character answer
    expect(prompt).not.toContain('A'.repeat(500));
    // Should contain truncated version
    expect(prompt).toContain('A'.repeat(MAX_ANSWER_PREVIEW_LENGTH));
  });

  it('should not truncate short answers', () => {
    const prompt = buildAnalysisUserPrompt([sampleLog]);
    expect(prompt).toContain('The revenue was $4.2 billion last quarter.');
    // Should not have ellipsis for short answers
    const answerWithEllipsis = 'The revenue was $4.2 billion last quarter....';
    expect(prompt).not.toContain(answerWithEllipsis);
  });

  it('should handle empty logs array', () => {
    const prompt = buildAnalysisUserPrompt([]);
    expect(prompt).toContain('0 Q&A interaction logs');
  });

  it('should include log index numbers', () => {
    const prompt = buildAnalysisUserPrompt([sampleLog, flaggedLog]);
    expect(prompt).toContain('[Log 1]');
    expect(prompt).toContain('[Log 2]');
  });

  it('should round confidence percentages', () => {
    const logWithDecimal: AnalysisLog = {
      ...sampleLog,
      confidence: 0.857,
    };
    const prompt = buildAnalysisUserPrompt([logWithDecimal]);
    expect(prompt).toContain('86%');
  });
});

// =============================================================================
// Tests: Schema Validation
// =============================================================================

describe('analysisResultSchema', () => {
  it('should validate a complete valid response', () => {
    const validResponse = {
      topTopics: ['Revenue', 'Growth', 'Strategy'],
      userConcerns: ['Profit margins', 'Competition'],
      attentionNeeded: [
        { logId: 'log-123', reason: 'Low confidence', priority: 'high' as const },
      ],
      overallInsights: 'Users are primarily interested in financial performance.',
    };

    const result = analysisResultSchema.parse(validResponse);
    expect(result).toEqual(validResponse);
  });

  it('should provide defaults for missing fields', () => {
    const minimalResponse = {};
    const result = analysisResultSchema.parse(minimalResponse);

    expect(result.topTopics).toEqual([]);
    expect(result.userConcerns).toEqual([]);
    expect(result.attentionNeeded).toEqual([]);
    expect(result.overallInsights).toBe('');
  });

  it('should validate priority enum values', () => {
    const validPriorities = ['high', 'medium', 'low'];

    for (const priority of validPriorities) {
      const response = {
        attentionNeeded: [{ logId: 'test', reason: 'test', priority }],
      };
      expect(() => analysisResultSchema.parse(response)).not.toThrow();
    }
  });

  it('should reject invalid priority values', () => {
    const invalidResponse = {
      attentionNeeded: [{ logId: 'test', reason: 'test', priority: 'critical' }],
    };

    expect(() => analysisResultSchema.parse(invalidResponse)).toThrow();
  });

  it('should reject attentionNeeded items missing required fields', () => {
    const invalidResponse = {
      attentionNeeded: [{ logId: 'test' }], // missing reason and priority
    };

    expect(() => analysisResultSchema.parse(invalidResponse)).toThrow();
  });

  it('should accept partial attentionNeeded with defaults', () => {
    const response = {
      topTopics: ['Topic 1'],
      overallInsights: 'Summary',
    };

    const result = analysisResultSchema.parse(response);
    expect(result.attentionNeeded).toEqual([]);
    expect(result.userConcerns).toEqual([]);
  });

  it('should validate empty arrays', () => {
    const response = {
      topTopics: [],
      userConcerns: [],
      attentionNeeded: [],
      overallInsights: '',
    };

    const result = analysisResultSchema.parse(response);
    expect(result).toEqual(response);
  });

  it('should handle typical LLM response structure', () => {
    // Simulating what an LLM might actually return
    const llmResponse = {
      topTopics: ['Financial Performance', 'Risk Factors', 'Market Strategy'],
      userConcerns: [
        'Questions about revenue projections',
        'Concerns about regulatory compliance',
        'Interest in competitive positioning',
      ],
      attentionNeeded: [
        {
          logId: 'abc123',
          reason: 'Very low confidence (15%) - answer may be incomplete',
          priority: 'high' as const,
        },
        {
          logId: 'def456',
          reason: 'Topic not well covered in documents',
          priority: 'medium' as const,
        },
      ],
      overallInsights:
        'Users are primarily asking about financial metrics and competitive analysis. ' +
        'The system handles revenue questions well but struggles with detailed regulatory queries.',
    };

    const result = analysisResultSchema.parse(llmResponse);
    expect(result.topTopics).toHaveLength(3);
    expect(result.userConcerns).toHaveLength(3);
    expect(result.attentionNeeded).toHaveLength(2);
    expect(result.attentionNeeded[0].priority).toBe('high');
  });
});

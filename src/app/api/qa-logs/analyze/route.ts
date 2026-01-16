/**
 * Q&A Logs Analysis API Route
 *
 * POST /api/qa-logs/analyze - Analyze Q&A logs using LLM
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createLLMAdapterFromConfig } from '@/lib/llm';
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  analysisResultSchema,
  MAX_LOGS_TO_ANALYZE,
  AnalysisResult,
} from '@/lib/llm/analysis-prompts';
import { logger } from '@/lib/logger';

// Create a child logger for analysis API
const log = logger.child({ layer: 'api', service: 'qa-logs-analyze' });

// =============================================================================
// Request Validation
// =============================================================================

const analyzeRequestSchema = z.object({
  tenantSlug: z.string().min(1),
  logs: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        answer: z.string(),
        confidence: z.number(),
        flagged: z.boolean(),
      })
    )
    .min(1)
    .max(100),
});

// =============================================================================
// Response Types
// =============================================================================

interface AnalysisStats {
  totalAnalyzed: number;
  avgConfidence: number;
  lowConfidenceCount: number;
  flaggedCount: number;
}

interface AnalyzeResponse {
  summary: AnalysisResult;
  stats: AnalysisStats;
  tokensUsed: number;
}

// =============================================================================
// POST Handler - Analyze Q&A Logs
// =============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Parse and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body', code: 'INVALID_JSON' },
      { status: 400 }
    );
  }

  let params;
  try {
    params = analyzeRequestSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      log.error(
        { event: 'validation_error', errors: error.errors },
        'Analysis request validation failed'
      );
      return Response.json(
        { error: 'Invalid request', code: 'INVALID_PARAMS', details: error.errors },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Invalid request', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const { tenantSlug, logs } = params;

  log.info(
    { event: 'analyze_start', tenantSlug, logCount: logs.length },
    'Starting Q&A logs analysis'
  );

  // Limit logs for analysis to manage token usage
  const logsToAnalyze = logs.slice(0, MAX_LOGS_TO_ANALYZE);

  // Calculate stats before analysis
  const stats: AnalysisStats = {
    totalAnalyzed: logsToAnalyze.length,
    avgConfidence:
      logsToAnalyze.reduce((sum, l) => sum + l.confidence, 0) / logsToAnalyze.length,
    lowConfidenceCount: logsToAnalyze.filter((l) => l.confidence < 0.5).length,
    flaggedCount: logsToAnalyze.filter((l) => l.flagged).length,
  };

  try {
    // Create LLM adapter using global OpenAI key
    const llm = createLLMAdapterFromConfig('openai', null);

    // Build prompts
    const systemPrompt = buildAnalysisSystemPrompt();
    const userPrompt = buildAnalysisUserPrompt(logsToAnalyze);

    // Call LLM for analysis
    const response = await llm.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.3,
        maxTokens: 2000,
      }
    );

    // Parse and validate JSON response from LLM
    let analysis: AnalysisResult;
    try {
      // Clean up the response - remove any markdown code blocks if present
      let content = response.content.trim();
      if (content.startsWith('```json')) {
        content = content.slice(7);
      }
      if (content.startsWith('```')) {
        content = content.slice(3);
      }
      if (content.endsWith('```')) {
        content = content.slice(0, -3);
      }
      content = content.trim();

      const parsed = JSON.parse(content);

      // Validate the parsed JSON against our schema
      analysis = analysisResultSchema.parse(parsed);
    } catch (parseError) {
      const errorMessage =
        parseError instanceof z.ZodError
          ? `Schema validation failed: ${parseError.errors.map((e) => e.message).join(', ')}`
          : 'Invalid JSON structure';

      log.error(
        {
          event: 'parse_error',
          tenantSlug,
          response: response.content.slice(0, 500),
          error: errorMessage,
        },
        'Failed to parse LLM analysis response'
      );
      return Response.json(
        { error: 'Failed to parse analysis results', code: 'PARSE_ERROR' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    log.info(
      {
        event: 'analyze_complete',
        tenantSlug,
        logCount: logsToAnalyze.length,
        tokensUsed: response.usage.totalTokens,
        duration_ms: duration,
      },
      'Q&A logs analysis completed'
    );

    const result: AnalyzeResponse = {
      summary: analysis,
      stats,
      tokensUsed: response.usage.totalTokens,
    };

    return Response.json(result);
  } catch (error) {
    log.error(
      {
        event: 'analyze_error',
        tenantSlug,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to analyze Q&A logs'
    );
    return Response.json(
      { error: 'Analysis failed', code: 'ANALYSIS_ERROR' },
      { status: 500 }
    );
  }
}

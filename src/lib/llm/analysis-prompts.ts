/**
 * Analysis Prompts for Q&A Log Analysis
 *
 * Prompt templates for analyzing Q&A logs to identify patterns,
 * user concerns, and logs that need attention.
 */

import { z } from 'zod';

// =============================================================================
// Constants
// =============================================================================

export const MAX_ANSWER_PREVIEW_LENGTH = 300;
export const MAX_LOGS_TO_ANALYZE = 50;

// =============================================================================
// Types & Validation Schemas
// =============================================================================

export interface AnalysisLog {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  flagged: boolean;
}

/**
 * Zod schema for validating LLM analysis response.
 * Ensures the parsed JSON has the expected structure.
 */
export const analysisResultSchema = z.object({
  topTopics: z.array(z.string()).default([]),
  userConcerns: z.array(z.string()).default([]),
  attentionNeeded: z
    .array(
      z.object({
        logId: z.string(),
        reason: z.string(),
        priority: z.enum(['high', 'medium', 'low']),
      })
    )
    .default([]),
  overallInsights: z.string().default(''),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// =============================================================================
// Prompts
// =============================================================================

/**
 * Build the system prompt for Q&A log analysis.
 */
export function buildAnalysisSystemPrompt(): string {
  return `You are an analytics expert reviewing Q&A interaction logs for a company disclosure Q&A system.

Your task is to analyze the provided Q&A logs and extract actionable insights for administrators.

ANALYSIS REQUIREMENTS:
1. Identify the TOP 3-5 most common question topics or themes
2. Summarize what users are most concerned about or interested in
3. Flag specific logs that need administrator attention (low confidence, potential issues, unanswered questions)
4. Provide a brief overall assessment of the Q&A system performance

RESPONSE FORMAT:
You MUST respond with valid JSON only, no other text or markdown:
{
  "topTopics": ["topic1", "topic2", "topic3"],
  "userConcerns": ["concern1", "concern2"],
  "attentionNeeded": [
    {
      "logId": "the-log-id",
      "reason": "brief explanation of why this needs attention",
      "priority": "high"
    }
  ],
  "overallInsights": "2-3 sentence summary of patterns and recommendations"
}

PRIORITY GUIDELINES for attentionNeeded:
- HIGH: Confidence below 30%, user explicitly flagged it, answer seems incomplete or wrong
- MEDIUM: Confidence between 30-50%, topic not well covered in documents, user might be confused
- LOW: Minor issues, could be improved but not urgent

IMPORTANT:
- Only include logs in attentionNeeded if they truly need attention (max 5-10 items)
- Keep topTopics to 3-5 items maximum
- Keep userConcerns to 3-5 items maximum
- Be concise but specific in your analysis`;
}

/**
 * Build the user prompt with the logs to analyze.
 */
export function buildAnalysisUserPrompt(logs: AnalysisLog[]): string {
  const logsText = logs
    .map((log, i) => {
      const truncatedAnswer =
        log.answer.length > MAX_ANSWER_PREVIEW_LENGTH
          ? log.answer.slice(0, MAX_ANSWER_PREVIEW_LENGTH) + '...'
          : log.answer;

      return `[Log ${i + 1}] ID: ${log.id}
Question: ${log.question}
Answer: ${truncatedAnswer}
Confidence: ${Math.round(log.confidence * 100)}%
Flagged: ${log.flagged ? 'Yes' : 'No'}`;
    })
    .join('\n\n---\n\n');

  return `Analyze these ${logs.length} Q&A interaction logs and provide insights:

${logsText}

Respond with JSON only, following the format specified in the system prompt.`;
}

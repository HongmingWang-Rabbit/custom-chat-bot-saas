/**
 * Q&A API Route
 *
 * POST /api/qa
 *
 * Handles RAG-based Q&A with streaming responses.
 * Uses tenant-specific database and LLM configuration.
 *
 * Security:
 * - Input validation with Zod
 * - Injection detection and sanitization
 * - Suspicious inputs are flagged but still processed (defense in depth)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantService } from '@/lib/services/tenant-service';
import { createRAGService, RAGResponse, Citation } from '@/lib/rag';
import {
  shouldBlockInput,
  assessInputLegitimacy,
  MAX_LENGTHS,
} from '@/lib/llm';
import {
  createRequestContext,
  createLayerLogger,
  logSecurityEvent,
  logRagStep,
  Timer,
  truncateText,
} from '@/lib/logger';

// =============================================================================
// Request Validation
// =============================================================================

const qaRequestSchema = z.object({
  question: z.string().min(1).max(MAX_LENGTHS.USER_QUESTION),
  tenantSlug: z.string().min(1).max(100),
  sessionId: z.string().optional(),
  stream: z.boolean().optional().default(true),
});

type QARequest = z.infer<typeof qaRequestSchema>;

// =============================================================================
// Streaming Response Helpers
// =============================================================================

/**
 * Create a streaming response encoder.
 */
function createSSEStream() {
  const encoder = new TextEncoder();

  return {
    encoder,
    formatEvent(event: string, data: unknown): string {
      return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    },
  };
}

/**
 * Send Server-Sent Event data.
 */
function sendSSE(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
): void {
  const formatted = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(formatted));
}

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(request: NextRequest) {
  // Create request context and logger
  const ctx = createRequestContext({
    path: '/api/qa',
    method: 'POST',
  });
  const log = createLayerLogger('api', ctx);
  const timer = new Timer();

  log.info({ event: 'request_start' }, 'Q&A request received');

  // Parse request body
  let body: QARequest;
  try {
    const json = await request.json();
    body = qaRequestSchema.parse(json);
  } catch (error) {
    log.warn(
      { event: 'validation_error', error: error instanceof Error ? error.message : String(error) },
      'Invalid request body'
    );
    return Response.json(
      {
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      {
        status: 400,
        headers: { 'X-Trace-Id': ctx.traceId },
      }
    );
  }

  const { question, tenantSlug, sessionId, stream } = body;

  // Update context with tenant info
  log.info(
    {
      event: 'request_parsed',
      tenant: tenantSlug,
      questionLength: question.length,
      stream,
    },
    `Processing Q&A for tenant: ${tenantSlug}`
  );

  // ==========================================================================
  // Security: Input Validation
  // ==========================================================================

  timer.mark('security');

  // Check if input should be blocked entirely
  const blockCheck = shouldBlockInput(question);
  if (blockCheck.block) {
    const securityLog = createLayerLogger('security', ctx);
    logSecurityEvent(securityLog, 'prompt_injection', {
      input: question,
      reason: blockCheck.reason || undefined,
    });

    return Response.json(
      {
        error: 'Invalid question format',
        code: 'INVALID_INPUT',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      {
        status: 400,
        headers: { 'X-Trace-Id': ctx.traceId },
      }
    );
  }

  // Assess input legitimacy (for logging/monitoring)
  const legitimacy = assessInputLegitimacy(question);
  if (legitimacy.score < 0.5) {
    const securityLog = createLayerLogger('security', ctx);
    logSecurityEvent(securityLog, 'suspicious_input', {
      input: question,
      confidence: legitimacy.score,
      reason: legitimacy.reasons.join(', '),
    });
    // We don't block here - the sanitization and defensive prompts will handle it
  }

  timer.measure('security');
  log.debug({ duration_ms: timer.getDuration('security') }, 'Security check completed');

  // ==========================================================================
  // Tenant Resolution
  // ==========================================================================

  timer.mark('tenant');

  // Get tenant service
  const tenantService = getTenantService();

  // Get tenant with secrets (for DB and LLM access)
  const tenant = await tenantService.getTenantWithSecrets(tenantSlug);
  if (!tenant) {
    log.warn({ tenant: tenantSlug }, 'Tenant not found');
    return Response.json(
      {
        error: 'Tenant not found',
        code: 'TENANT_NOT_FOUND',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      {
        status: 404,
        headers: { 'X-Trace-Id': ctx.traceId },
      }
    );
  }

  // Get tenant database
  const tenantDb = await tenantService.getTenantDb(tenantSlug);
  if (!tenantDb) {
    log.error({ tenant: tenantSlug }, 'Failed to connect to tenant database');
    return Response.json(
      {
        error: 'Failed to connect to tenant database',
        code: 'DB_CONNECTION_ERROR',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      {
        status: 500,
        headers: { 'X-Trace-Id': ctx.traceId },
      }
    );
  }

  timer.measure('tenant');
  log.debug({ duration_ms: timer.getDuration('tenant') }, 'Tenant resolved');

  // Create RAG service for this tenant
  const ragService = createRAGService(
    tenantDb,
    tenant.llmApiKey,
    tenant.ragConfig,
    tenantSlug
  );

  // Handle streaming response
  if (stream) {
    return handleStreamingResponse(ragService, question, tenantSlug, sessionId, ctx, timer);
  }

  // Handle non-streaming response
  return handleNonStreamingResponse(ragService, question, tenantSlug, sessionId, ctx, timer);
}

// =============================================================================
// Response Handlers
// =============================================================================

/**
 * Handle streaming Q&A response using SSE.
 */
async function handleStreamingResponse(
  ragService: ReturnType<typeof createRAGService>,
  question: string,
  tenantSlug: string,
  sessionId: string | undefined,
  ctx: ReturnType<typeof createRequestContext>,
  timer: Timer
): Promise<Response> {
  const { encoder } = createSSEStream();
  const log = createLayerLogger('rag', ctx);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Send start event with traceId
        sendSSE(controller, encoder, 'start', {
          status: 'processing',
          traceId: ctx.traceId,
        });

        timer.mark('rag');

        // Execute RAG query with streaming
        await ragService.queryStream(
          { query: question, tenantSlug, sessionId },
          {
            onChunk: (chunk: string) => {
              sendSSE(controller, encoder, 'chunk', { content: chunk });
            },
            onCitations: (citations: Citation[]) => {
              logRagStep(log, 'citation', { chunks: citations.length });
              sendSSE(controller, encoder, 'citations', {
                citations: citations.map((c) => ({
                  id: c.id,
                  documentTitle: c.documentTitle,
                  snippet: c.chunkContent.slice(0, 150),
                  confidence: c.confidence,
                  source: c.source,
                })),
              });
            },
            onComplete: (response: RAGResponse) => {
              timer.measure('rag');
              logRagStep(log, 'generation', {
                duration_ms: timer.getDuration('rag'),
                chunks: response.retrievedChunks,
                tokens: response.tokensUsed.embedding + response.tokensUsed.completion,
                confidence: response.confidence,
              });

              // Check for low confidence
              if (response.confidence < 0.5) {
                const securityLog = createLayerLogger('security', ctx);
                logSecurityEvent(securityLog, 'low_confidence', {
                  input: question,
                  confidence: response.confidence,
                });
              }

              sendSSE(controller, encoder, 'complete', {
                confidence: response.confidence,
                retrievedChunks: response.retrievedChunks,
                tokensUsed: response.tokensUsed,
                debug: {
                  traceId: ctx.traceId,
                  ...timer.getAllDurations(),
                  total_ms: timer.elapsed(),
                },
              });

              log.info(
                {
                  event: 'request_complete',
                  confidence: response.confidence,
                  chunks: response.retrievedChunks,
                  tokens: response.tokensUsed,
                  total_ms: timer.elapsed(),
                },
                'Q&A request completed successfully'
              );
            },
            onError: (error: Error) => {
              log.error(
                { event: 'rag_error', error: error.message },
                'RAG pipeline error'
              );
              sendSSE(controller, encoder, 'error', {
                error: error.message,
                code: 'RAG_ERROR',
                debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
              });
            },
          }
        );
      } catch (error) {
        log.error(
          {
            event: 'stream_error',
            error: error instanceof Error ? error.message : String(error),
          },
          'Streaming error'
        );
        sendSSE(controller, encoder, 'error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          code: 'STREAM_ERROR',
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Trace-Id': ctx.traceId,
    },
  });
}

/**
 * Handle non-streaming Q&A response.
 */
async function handleNonStreamingResponse(
  ragService: ReturnType<typeof createRAGService>,
  question: string,
  tenantSlug: string,
  sessionId: string | undefined,
  ctx: ReturnType<typeof createRequestContext>,
  timer: Timer
): Promise<Response> {
  const log = createLayerLogger('rag', ctx);

  try {
    timer.mark('rag');

    const response = await ragService.query({
      query: question,
      tenantSlug,
      sessionId,
    });

    timer.measure('rag');

    logRagStep(log, 'generation', {
      duration_ms: timer.getDuration('rag'),
      chunks: response.retrievedChunks,
      tokens: response.tokensUsed.embedding + response.tokensUsed.completion,
      confidence: response.confidence,
    });

    // Check for low confidence
    if (response.confidence < 0.5) {
      const securityLog = createLayerLogger('security', ctx);
      logSecurityEvent(securityLog, 'low_confidence', {
        input: question,
        confidence: response.confidence,
      });
    }

    log.info(
      {
        event: 'request_complete',
        confidence: response.confidence,
        chunks: response.retrievedChunks,
        tokens: response.tokensUsed,
        total_ms: timer.elapsed(),
      },
      'Q&A request completed successfully'
    );

    return Response.json(
      {
        answer: response.answer,
        citations: response.citations.map((c) => ({
          id: c.id,
          documentTitle: c.documentTitle,
          snippet: c.chunkContent.slice(0, 150),
          confidence: c.confidence,
          source: c.source,
        })),
        confidence: response.confidence,
        retrievedChunks: response.retrievedChunks,
        tokensUsed: response.tokensUsed,
        debug: {
          traceId: ctx.traceId,
          ...timer.getAllDurations(),
          total_ms: timer.elapsed(),
        },
      },
      {
        headers: { 'X-Trace-Id': ctx.traceId },
      }
    );
  } catch (error) {
    log.error(
      {
        event: 'query_error',
        error: error instanceof Error ? error.message : String(error),
      },
      'Query failed'
    );

    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Query failed',
        code: 'QUERY_ERROR',
        debug: {
          traceId: ctx.traceId,
          ...timer.getAllDurations(),
          total_ms: timer.elapsed(),
        },
      },
      {
        status: 500,
        headers: { 'X-Trace-Id': ctx.traceId },
      }
    );
  }
}

// =============================================================================
// OPTIONS Handler (CORS preflight)
// =============================================================================

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

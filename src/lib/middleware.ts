/**
 * Request Middleware Utilities
 *
 * Provides request tracing and logging integration for API routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createRequestContext,
  createRequestLogger,
  logRequestStart,
  logRequestEnd,
  Timer,
  RequestContext,
  Logger,
} from './logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Extended request context with logger and timer
 */
export interface ApiContext extends RequestContext {
  log: Logger;
  timer: Timer;
}

/**
 * API handler function type
 */
export type ApiHandler<T = unknown> = (
  req: NextRequest,
  ctx: ApiContext
) => Promise<NextResponse<T>>;

// =============================================================================
// Response Headers
// =============================================================================

/**
 * Add trace headers to a response
 */
export function addTraceHeaders(
  response: NextResponse,
  ctx: RequestContext
): NextResponse {
  response.headers.set('X-Trace-Id', ctx.traceId);
  response.headers.set('X-Request-Duration', `${Date.now() - ctx.startTime}ms`);
  return response;
}

// =============================================================================
// API Wrapper
// =============================================================================

/**
 * Wrap an API handler with request tracing and logging.
 *
 * Usage:
 * ```ts
 * export const POST = withLogging(async (req, ctx) => {
 *   ctx.log.info('Processing request');
 *   // ... handler logic
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withLogging<T>(handler: ApiHandler<T>) {
  return async (req: NextRequest): Promise<NextResponse<T>> => {
    // Extract tenant slug from URL if present
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const tenantSlug = pathParts.includes('demo')
      ? pathParts[pathParts.indexOf('demo') + 1]
      : undefined;

    // Create request context
    const ctx: ApiContext = {
      ...createRequestContext({
        tenantSlug,
        path: url.pathname,
        method: req.method,
      }),
      log: null!, // Will be set below
      timer: new Timer(),
    };

    // Create request-bound logger
    ctx.log = createRequestLogger(ctx);

    // Log request start
    logRequestStart(ctx.log, {
      method: req.method,
      url: url.pathname,
      headers: Object.fromEntries(req.headers.entries()),
    });

    try {
      // Execute handler
      const response = await handler(req, ctx);

      // Add trace headers
      addTraceHeaders(response, ctx);

      // Log request end
      logRequestEnd(ctx.log, response.status, ctx.timer.elapsed());

      return response;
    } catch (error) {
      // Log error
      ctx.log.error(
        {
          event: 'request_error',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Request failed with unhandled error'
      );

      // Create error response
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: 'Internal server error',
          debug: {
            traceId: ctx.traceId,
            total_ms: ctx.timer.elapsed(),
          },
        },
        { status: 500 }
      ) as NextResponse<T>;

      addTraceHeaders(errorResponse, ctx);
      logRequestEnd(ctx.log, 500, ctx.timer.elapsed());

      return errorResponse;
    }
  };
}

// =============================================================================
// Error Response Helpers
// =============================================================================

/**
 * Create a standardized error response with trace info
 */
export function createErrorResponse(
  ctx: ApiContext,
  status: number,
  message: string,
  details?: Record<string, unknown>
): NextResponse {
  const response = NextResponse.json(
    {
      success: false,
      error: message,
      ...details,
      debug: {
        traceId: ctx.traceId,
        ...ctx.timer.getAllDurations(),
        total_ms: ctx.timer.elapsed(),
      },
    },
    { status }
  );

  return addTraceHeaders(response, ctx);
}

/**
 * Create a standardized success response with trace info
 */
export function createSuccessResponse<T>(
  ctx: ApiContext,
  data: T,
  status = 200
): NextResponse {
  const response = NextResponse.json(
    {
      success: true,
      ...data,
      debug: {
        traceId: ctx.traceId,
        ...ctx.timer.getAllDurations(),
        total_ms: ctx.timer.elapsed(),
      },
    },
    { status }
  );

  return addTraceHeaders(response, ctx);
}

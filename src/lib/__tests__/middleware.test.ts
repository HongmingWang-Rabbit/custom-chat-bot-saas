/**
 * Tests for Request Middleware Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  addTraceHeaders,
  withLogging,
  createErrorResponse,
  createSuccessResponse,
  ApiContext,
} from '../middleware';
import { createRequestContext, Timer } from '../logger';

// =============================================================================
// Mock NextRequest/NextResponse
// =============================================================================

function createMockRequest(
  url: string,
  options?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  return {
    url,
    method: options?.method || 'GET',
    headers: new Headers(options?.headers || {}),
    json: vi.fn().mockResolvedValue({}),
    formData: vi.fn(),
  } as unknown as NextRequest;
}

function createMockContext(): ApiContext {
  const ctx = createRequestContext({
    path: '/api/test',
    method: 'POST',
  });
  return {
    ...ctx,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      bindings: () => ({ traceId: ctx.traceId }),
    } as any,
    timer: new Timer(),
  };
}

// =============================================================================
// addTraceHeaders Tests
// =============================================================================

describe('addTraceHeaders', () => {
  it('should add X-Trace-Id header', () => {
    const ctx = createRequestContext();
    const response = NextResponse.json({ test: true });

    const result = addTraceHeaders(response, ctx);

    expect(result.headers.get('X-Trace-Id')).toBe(ctx.traceId);
  });

  it('should add X-Request-Duration header', () => {
    const ctx = createRequestContext();
    // Simulate some time passing
    const response = NextResponse.json({ test: true });

    const result = addTraceHeaders(response, ctx);

    const duration = result.headers.get('X-Request-Duration');
    expect(duration).toBeDefined();
    expect(duration).toMatch(/^\d+ms$/);
  });

  it('should preserve existing response data', async () => {
    const ctx = createRequestContext();
    const response = NextResponse.json({ data: 'value' }, { status: 201 });

    const result = addTraceHeaders(response, ctx);

    expect(result.status).toBe(201);
  });
});

// =============================================================================
// withLogging Tests
// =============================================================================

describe('withLogging', () => {
  it('should wrap handler and return response', async () => {
    const handler = vi.fn().mockResolvedValue(
      NextResponse.json({ success: true })
    );
    const wrapped = withLogging(handler);
    const req = createMockRequest('https://example.com/api/test', {
      method: 'POST',
    });

    const response = await wrapped(req);

    expect(handler).toHaveBeenCalled();
    expect(response).toBeInstanceOf(NextResponse);
  });

  it('should provide context to handler', async () => {
    let capturedCtx: ApiContext | null = null;
    const handler = vi.fn().mockImplementation((req, ctx) => {
      capturedCtx = ctx;
      return NextResponse.json({ success: true });
    });
    const wrapped = withLogging(handler);
    const req = createMockRequest('https://example.com/api/test');

    await wrapped(req);

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.traceId).toBeDefined();
    expect(capturedCtx!.log).toBeDefined();
    expect(capturedCtx!.timer).toBeDefined();
  });

  it('should add trace headers to response', async () => {
    const handler = vi.fn().mockResolvedValue(
      NextResponse.json({ success: true })
    );
    const wrapped = withLogging(handler);
    const req = createMockRequest('https://example.com/api/test');

    const response = await wrapped(req);

    expect(response.headers.get('X-Trace-Id')).toBeDefined();
    expect(response.headers.get('X-Request-Duration')).toBeDefined();
  });

  it('should extract tenant slug from demo path', async () => {
    let capturedCtx: ApiContext | null = null;
    const handler = vi.fn().mockImplementation((req, ctx) => {
      capturedCtx = ctx;
      return NextResponse.json({ success: true });
    });
    const wrapped = withLogging(handler);
    const req = createMockRequest('https://example.com/demo/my-tenant/page');

    await wrapped(req);

    expect(capturedCtx?.tenantSlug).toBe('my-tenant');
  });

  it('should handle errors gracefully', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Test error'));
    const wrapped = withLogging(handler);
    const req = createMockRequest('https://example.com/api/test');

    const response = await wrapped(req);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Internal server error');
    expect(data.debug.traceId).toBeDefined();
  });

  it('should include timing in error response', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Test error'));
    const wrapped = withLogging(handler);
    const req = createMockRequest('https://example.com/api/test');

    const response = await wrapped(req);
    const data = await response.json();

    expect(data.debug.total_ms).toBeDefined();
    expect(typeof data.debug.total_ms).toBe('number');
  });
});

// =============================================================================
// createErrorResponse Tests
// =============================================================================

describe('createErrorResponse', () => {
  it('should create error response with correct status', () => {
    const ctx = createMockContext();

    const response = createErrorResponse(ctx, 400, 'Bad request');

    expect(response.status).toBe(400);
  });

  it('should include error message', async () => {
    const ctx = createMockContext();

    const response = createErrorResponse(ctx, 404, 'Not found');
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBe('Not found');
  });

  it('should include debug info with traceId', async () => {
    const ctx = createMockContext();

    const response = createErrorResponse(ctx, 500, 'Server error');
    const data = await response.json();

    expect(data.debug.traceId).toBe(ctx.traceId);
    expect(data.debug.total_ms).toBeDefined();
  });

  it('should include additional details', async () => {
    const ctx = createMockContext();

    const response = createErrorResponse(ctx, 400, 'Validation failed', {
      details: [{ field: 'email', message: 'Invalid email' }],
    });
    const data = await response.json();

    expect(data.details).toBeDefined();
    expect(data.details[0].field).toBe('email');
  });

  it('should add trace headers', () => {
    const ctx = createMockContext();

    const response = createErrorResponse(ctx, 500, 'Error');

    expect(response.headers.get('X-Trace-Id')).toBe(ctx.traceId);
  });

  it('should include timing info from timer', async () => {
    const ctx = createMockContext();
    ctx.timer.mark('operation');
    ctx.timer.measure('operation');

    const response = createErrorResponse(ctx, 400, 'Error');
    const data = await response.json();

    expect(data.debug).toHaveProperty('operation_ms');
  });
});

// =============================================================================
// createSuccessResponse Tests
// =============================================================================

describe('createSuccessResponse', () => {
  it('should create success response with default 200 status', () => {
    const ctx = createMockContext();

    const response = createSuccessResponse(ctx, { data: 'test' });

    expect(response.status).toBe(200);
  });

  it('should allow custom status code', () => {
    const ctx = createMockContext();

    const response = createSuccessResponse(ctx, { id: '123' }, 201);

    expect(response.status).toBe(201);
  });

  it('should include success flag', async () => {
    const ctx = createMockContext();

    const response = createSuccessResponse(ctx, { result: 'ok' });
    const data = await response.json();

    expect(data.success).toBe(true);
  });

  it('should include provided data', async () => {
    const ctx = createMockContext();

    const response = createSuccessResponse(ctx, {
      items: [1, 2, 3],
      count: 3,
    });
    const data = await response.json();

    expect(data.items).toEqual([1, 2, 3]);
    expect(data.count).toBe(3);
  });

  it('should include debug info', async () => {
    const ctx = createMockContext();

    const response = createSuccessResponse(ctx, { value: 42 });
    const data = await response.json();

    expect(data.debug.traceId).toBe(ctx.traceId);
    expect(data.debug.total_ms).toBeDefined();
  });

  it('should add trace headers', () => {
    const ctx = createMockContext();

    const response = createSuccessResponse(ctx, {});

    expect(response.headers.get('X-Trace-Id')).toBe(ctx.traceId);
    expect(response.headers.get('X-Request-Duration')).toBeDefined();
  });

  it('should include all timer durations', async () => {
    const ctx = createMockContext();
    ctx.timer.mark('db');
    ctx.timer.measure('db');
    ctx.timer.mark('external');
    ctx.timer.measure('external');

    const response = createSuccessResponse(ctx, {});
    const data = await response.json();

    expect(data.debug).toHaveProperty('db_ms');
    expect(data.debug).toHaveProperty('external_ms');
  });
});

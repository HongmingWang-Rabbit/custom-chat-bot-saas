/**
 * Tests for Logger Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logger,
  createRequestContext,
  createRequestLogger,
  createLayerLogger,
  loggers,
  sanitizeString,
  truncateText,
  sanitizeEmbedding,
  sanitizeForLogging,
  Timer,
  logRequestStart,
  logRequestEnd,
  logDbOperation,
  logExternalCall,
  logSecurityEvent,
  logRagStep,
  logAdminAction,
} from '../logger';

// =============================================================================
// createRequestContext Tests
// =============================================================================

describe('createRequestContext', () => {
  it('should create context with unique traceId', () => {
    const ctx1 = createRequestContext();
    const ctx2 = createRequestContext();

    expect(ctx1.traceId).toBeDefined();
    expect(ctx2.traceId).toBeDefined();
    expect(ctx1.traceId).not.toBe(ctx2.traceId);
  });

  it('should create context with UUID format traceId', () => {
    const ctx = createRequestContext();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(ctx.traceId).toMatch(uuidRegex);
  });

  it('should include optional parameters', () => {
    const ctx = createRequestContext({
      tenantSlug: 'test-tenant',
      path: '/api/qa',
      method: 'POST',
    });

    expect(ctx.tenantSlug).toBe('test-tenant');
    expect(ctx.path).toBe('/api/qa');
    expect(ctx.method).toBe('POST');
  });

  it('should set startTime to current timestamp', () => {
    const before = Date.now();
    const ctx = createRequestContext();
    const after = Date.now();

    expect(ctx.startTime).toBeGreaterThanOrEqual(before);
    expect(ctx.startTime).toBeLessThanOrEqual(after);
  });

  it('should handle missing optional parameters', () => {
    const ctx = createRequestContext();

    expect(ctx.tenantSlug).toBeUndefined();
    expect(ctx.path).toBeUndefined();
    expect(ctx.method).toBeUndefined();
  });
});

// =============================================================================
// createRequestLogger Tests
// =============================================================================

describe('createRequestLogger', () => {
  it('should create child logger with traceId', () => {
    const ctx = createRequestContext();
    const log = createRequestLogger(ctx);

    expect(log).toBeDefined();
    // Pino child loggers have bindings
    expect(log.bindings().traceId).toBe(ctx.traceId);
  });

  it('should include tenant in bindings when provided', () => {
    const ctx = createRequestContext({ tenantSlug: 'my-tenant' });
    const log = createRequestLogger(ctx);

    expect(log.bindings().tenant).toBe('my-tenant');
  });

  it('should include path and method when provided', () => {
    const ctx = createRequestContext({
      path: '/api/test',
      method: 'GET',
    });
    const log = createRequestLogger(ctx);

    expect(log.bindings().path).toBe('/api/test');
    expect(log.bindings().method).toBe('GET');
  });
});

// =============================================================================
// createLayerLogger Tests
// =============================================================================

describe('createLayerLogger', () => {
  it('should create logger with layer binding', () => {
    const log = createLayerLogger('api');
    expect(log.bindings().layer).toBe('api');
  });

  it('should support all layer types', () => {
    const layers = ['api', 'rag', 'db', 'external', 'security', 'admin'] as const;

    for (const layer of layers) {
      const log = createLayerLogger(layer);
      expect(log.bindings().layer).toBe(layer);
    }
  });

  it('should include request context when provided', () => {
    const ctx = createRequestContext({ tenantSlug: 'tenant-1' });
    const log = createLayerLogger('rag', ctx);

    expect(log.bindings().layer).toBe('rag');
    expect(log.bindings().traceId).toBe(ctx.traceId);
    expect(log.bindings().tenant).toBe('tenant-1');
  });
});

// =============================================================================
// Pre-configured Loggers Tests
// =============================================================================

describe('loggers', () => {
  it('should have all layer loggers available', () => {
    expect(loggers.api).toBeDefined();
    expect(loggers.rag).toBeDefined();
    expect(loggers.db).toBeDefined();
    expect(loggers.external).toBeDefined();
    expect(loggers.security).toBeDefined();
    expect(loggers.admin).toBeDefined();
  });

  it('should have correct layer bindings', () => {
    expect(loggers.api.bindings().layer).toBe('api');
    expect(loggers.rag.bindings().layer).toBe('rag');
    expect(loggers.db.bindings().layer).toBe('db');
    expect(loggers.external.bindings().layer).toBe('external');
    expect(loggers.security.bindings().layer).toBe('security');
    expect(loggers.admin.bindings().layer).toBe('admin');
  });
});

// =============================================================================
// sanitizeString Tests
// =============================================================================

describe('sanitizeString', () => {
  it('should redact OpenAI API keys', () => {
    const input = 'Using key sk-1234567890abcdefghijklmnop';
    const result = sanitizeString(input);
    expect(result).toBe('Using key [REDACTED]');
  });

  it('should redact Supabase access tokens', () => {
    const input = 'Token: sbp_abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeString(input);
    expect(result).toBe('Token: [REDACTED]');
  });

  it('should redact database URLs with credentials', () => {
    const input = 'DB: postgres://user:password@host:5432/db';
    const result = sanitizeString(input);
    expect(result).toBe('DB: [REDACTED]host:5432/db');
  });

  it('should redact Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    const result = sanitizeString(input);
    expect(result).toBe('Authorization: [REDACTED]');
  });

  it('should redact password values', () => {
    const input = 'password=secret123 and password: "hidden"';
    const result = sanitizeString(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret123');
    expect(result).not.toContain('hidden');
  });

  it('should redact api_key values', () => {
    const input = 'api_key=mykey123 and api-key: secretkey';
    const result = sanitizeString(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('mykey123');
  });

  it('should leave safe strings unchanged', () => {
    const input = 'This is a normal log message';
    const result = sanitizeString(input);
    expect(result).toBe(input);
  });

  it('should handle multiple sensitive patterns', () => {
    const input = 'Key: sk-abc123def456ghi789jkl012 Token: sbp_abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeString(input);
    expect(result).toBe('Key: [REDACTED] Token: [REDACTED]');
  });
});

// =============================================================================
// truncateText Tests
// =============================================================================

describe('truncateText', () => {
  it('should not truncate short text', () => {
    const input = 'Short text';
    const result = truncateText(input);
    expect(result).toBe(input);
  });

  it('should truncate long text with default limit', () => {
    const input = 'x'.repeat(300);
    const result = truncateText(input);
    expect(result.length).toBeLessThan(input.length);
    expect(result).toContain('...');
    expect(result).toContain('300 chars total');
  });

  it('should truncate to custom limit', () => {
    const input = 'This is a longer text that should be truncated';
    const result = truncateText(input, 20);
    expect(result).toBe('This is a longer tex... (46 chars total)');
  });

  it('should not truncate text at exact limit', () => {
    const input = 'x'.repeat(200);
    const result = truncateText(input, 200);
    expect(result).toBe(input);
  });

  it('should handle empty string', () => {
    const result = truncateText('');
    expect(result).toBe('');
  });
});

// =============================================================================
// sanitizeEmbedding Tests
// =============================================================================

describe('sanitizeEmbedding', () => {
  it('should return preview with first 5 dimensions', () => {
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const result = sanitizeEmbedding(embedding);

    expect(result.preview).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(result.dimensions).toBe(8);
  });

  it('should handle embedding shorter than preview limit', () => {
    const embedding = [0.1, 0.2, 0.3];
    const result = sanitizeEmbedding(embedding);

    expect(result.preview).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimensions).toBe(3);
  });

  it('should handle typical 1536-dimension embedding', () => {
    const embedding = new Array(1536).fill(0).map((_, i) => i / 1536);
    const result = sanitizeEmbedding(embedding);

    expect(result.preview).toHaveLength(5);
    expect(result.dimensions).toBe(1536);
  });

  it('should handle empty embedding', () => {
    const result = sanitizeEmbedding([]);
    expect(result.preview).toEqual([]);
    expect(result.dimensions).toBe(0);
  });
});

// =============================================================================
// sanitizeForLogging Tests
// =============================================================================

describe('sanitizeForLogging', () => {
  it('should sanitize string values', () => {
    const obj = {
      message: 'Using key sk-1234567890abcdefghijklmnop',
    };
    const result = sanitizeForLogging(obj);
    expect(result.message).toBe('Using key [REDACTED]');
  });

  it('should truncate specified keys', () => {
    const obj = {
      content: 'x'.repeat(500),
    };
    const result = sanitizeForLogging(obj, { truncateKeys: ['content'] });
    expect((result.content as string).length).toBeLessThan(500);
    expect(result.content).toContain('...');
  });

  it('should redact specified keys entirely', () => {
    const obj = {
      apiKey: 'secret-value',
      name: 'public-name',
    };
    const result = sanitizeForLogging(obj, { redactKeys: ['apiKey'] });
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.name).toBe('public-name');
  });

  it('should sanitize embedding arrays', () => {
    const obj = {
      embedding: new Array(1536).fill(0.5),
    };
    const result = sanitizeForLogging(obj);
    expect((result.embedding as { preview: number[]; dimensions: number }).preview).toHaveLength(5);
    expect((result.embedding as { preview: number[]; dimensions: number }).dimensions).toBe(1536);
  });

  it('should recursively sanitize nested objects', () => {
    const obj = {
      outer: {
        inner: {
          secret: 'sk-abcdefghijklmnopqrstuvwxyz',
        },
      },
    };
    const result = sanitizeForLogging(obj);
    expect((result.outer as Record<string, unknown>)).toBeDefined();
    const inner = (result.outer as Record<string, unknown>).inner as Record<string, unknown>;
    expect(inner.secret).toBe('[REDACTED]');
  });

  it('should preserve non-sensitive values', () => {
    const obj = {
      count: 42,
      enabled: true,
      items: ['a', 'b'],
    };
    const result = sanitizeForLogging(obj);
    expect(result.count).toBe(42);
    expect(result.enabled).toBe(true);
  });
});

// =============================================================================
// Timer Tests
// =============================================================================

describe('Timer', () => {
  it('should track elapsed time', async () => {
    const timer = new Timer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(timer.elapsed()).toBeGreaterThanOrEqual(10);
  });

  it('should mark and measure operations', () => {
    const timer = new Timer();
    timer.mark('operation');
    // Simulate some work
    for (let i = 0; i < 1000; i++) Math.sqrt(i);
    const duration = timer.measure('operation');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('should get specific duration', () => {
    const timer = new Timer();
    timer.mark('test');
    timer.measure('test');
    expect(timer.getDuration('test')).toBeDefined();
    expect(timer.getDuration('nonexistent')).toBeUndefined();
  });

  it('should return 0 for unmeasured mark', () => {
    const timer = new Timer();
    const duration = timer.measure('never-marked');
    expect(duration).toBe(0);
  });

  it('should get all durations', () => {
    const timer = new Timer();
    timer.mark('op1');
    timer.measure('op1');
    timer.mark('op2');
    timer.measure('op2');

    const durations = timer.getAllDurations();
    expect(durations).toHaveProperty('op1_ms');
    expect(durations).toHaveProperty('op2_ms');
  });

  it('should generate timing info', () => {
    const timer = new Timer();
    timer.mark('retrieval');
    timer.measure('retrieval');
    timer.mark('llm');
    timer.measure('llm');

    const info = timer.toTimingInfo('trace-123');
    expect(info.traceId).toBe('trace-123');
    expect(info.total_ms).toBeGreaterThanOrEqual(0);
    expect(info).toHaveProperty('retrieval_ms');
    expect(info).toHaveProperty('llm_ms');
  });
});

// =============================================================================
// Logging Helper Tests
// =============================================================================

describe('logRequestStart', () => {
  it('should log request info', () => {
    const mockLog = {
      info: vi.fn(),
    };

    logRequestStart(mockLog as any, {
      method: 'POST',
      url: '/api/qa',
      headers: { 'user-agent': 'test-agent' },
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'request_start',
        userAgent: 'test-agent',
      }),
      'POST /api/qa'
    );
  });
});

describe('logRequestEnd', () => {
  it('should log success with info level', () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    logRequestEnd(mockLog as any, 200, 150);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'request_end',
        status: 200,
        duration_ms: 150,
      }),
      expect.any(String)
    );
  });

  it('should log 4xx with warn level', () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    logRequestEnd(mockLog as any, 400, 50);

    expect(mockLog.warn).toHaveBeenCalled();
    expect(mockLog.info).not.toHaveBeenCalled();
  });

  it('should log 5xx with error level', () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    logRequestEnd(mockLog as any, 500, 100);

    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLog.info).not.toHaveBeenCalled();
  });
});

describe('logDbOperation', () => {
  it('should log successful operation with debug level', () => {
    const mockLog = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    logDbOperation(mockLog as any, 'select', {
      table: 'documents',
      rows: 10,
      duration_ms: 25,
    });

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'db_operation',
        operation: 'select',
        table: 'documents',
        rows: 10,
      }),
      expect.any(String)
    );
  });

  it('should log error with error level', () => {
    const mockLog = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    logDbOperation(mockLog as any, 'insert', {
      table: 'documents',
      duration_ms: 50,
      error: 'Connection failed',
    });

    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLog.debug).not.toHaveBeenCalled();
  });
});

describe('logExternalCall', () => {
  it('should log successful call with debug level', () => {
    const mockLog = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    logExternalCall(mockLog as any, 'openai', 'embed', {
      duration_ms: 200,
      tokens: 150,
      model: 'text-embedding-3-small',
    });

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'external_call',
        service: 'openai',
        operation: 'embed',
      }),
      expect.any(String)
    );
  });

  it('should log error with error level', () => {
    const mockLog = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    logExternalCall(mockLog as any, 'supabase', 'query', {
      error: 'Rate limited',
    });

    expect(mockLog.error).toHaveBeenCalled();
  });
});

describe('logSecurityEvent', () => {
  it('should log with warn level', () => {
    const mockLog = {
      warn: vi.fn(),
    };

    logSecurityEvent(mockLog as any, 'prompt_injection', {
      input: 'malicious input',
      reason: 'Contains system override',
    });

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security_prompt_injection',
        reason: 'Contains system override',
      }),
      'Security event: prompt_injection'
    );
  });

  it('should truncate long input', () => {
    const mockLog = {
      warn: vi.fn(),
    };

    const longInput = 'x'.repeat(200);
    logSecurityEvent(mockLog as any, 'suspicious_input', {
      input: longInput,
    });

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('...'),
      }),
      expect.any(String)
    );
  });

  it('should log low confidence events', () => {
    const mockLog = {
      warn: vi.fn(),
    };

    logSecurityEvent(mockLog as any, 'low_confidence', {
      confidence: 0.3,
    });

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security_low_confidence',
        confidence: 0.3,
      }),
      expect.any(String)
    );
  });
});

describe('logRagStep', () => {
  it('should log successful step with debug level', () => {
    const mockLog = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    logRagStep(mockLog as any, 'retrieval', {
      duration_ms: 35,
      chunks: 5,
    });

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'rag_retrieval',
        duration_ms: 35,
        chunks: 5,
      }),
      expect.any(String)
    );
  });

  it('should log error with error level', () => {
    const mockLog = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    logRagStep(mockLog as any, 'embedding', {
      error: 'OpenAI API error',
    });

    expect(mockLog.error).toHaveBeenCalled();
  });

  it('should support all RAG steps', () => {
    const mockLog = { debug: vi.fn(), error: vi.fn() };
    const steps = ['embedding', 'retrieval', 'reranking', 'generation', 'citation'] as const;

    for (const step of steps) {
      logRagStep(mockLog as any, step, { duration_ms: 10 });
      expect(mockLog.debug).toHaveBeenLastCalledWith(
        expect.objectContaining({ event: `rag_${step}` }),
        expect.any(String)
      );
    }
  });
});

describe('logAdminAction', () => {
  it('should log with info level', () => {
    const mockLog = {
      info: vi.fn(),
    };

    logAdminAction(mockLog as any, 'create_tenant', {
      target: 'new-tenant',
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'admin_action',
        action: 'create_tenant',
        target: 'new-tenant',
      }),
      'Admin action: create_tenant'
    );
  });

  it('should include count when provided', () => {
    const mockLog = {
      info: vi.fn(),
    };

    logAdminAction(mockLog as any, 'bulk_delete', {
      count: 15,
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 15,
      }),
      expect.any(String)
    );
  });
});

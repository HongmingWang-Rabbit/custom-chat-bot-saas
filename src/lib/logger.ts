/**
 * Structured Logging System
 *
 * Pino-based logging with:
 * - Request tracing via traceId
 * - Environment-based configuration
 * - Sensitive data sanitization
 * - Layer-specific child loggers
 * - Timing utilities
 */

import pino, { Logger, LoggerOptions } from 'pino';
import { randomUUID } from 'crypto';

// =============================================================================
// Configuration
// =============================================================================

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Pino configuration options
 */
const pinoOptions: LoggerOptions = {
  level: LOG_LEVEL,
  // Use JSON format in production, pretty print in development
  ...(IS_PRODUCTION
    ? {
        formatters: {
          level: (label) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
};

// =============================================================================
// Main Logger Instance
// =============================================================================

/**
 * Root logger instance.
 * Use child loggers for specific contexts.
 */
export const logger: Logger = pino(pinoOptions);

// =============================================================================
// Request Context
// =============================================================================

/**
 * Request context for tracing
 */
export interface RequestContext {
  traceId: string;
  tenantSlug?: string;
  path?: string;
  method?: string;
  startTime: number;
}

/**
 * Generate a new request context with unique traceId
 */
export function createRequestContext(options?: {
  tenantSlug?: string;
  path?: string;
  method?: string;
}): RequestContext {
  return {
    traceId: randomUUID(),
    tenantSlug: options?.tenantSlug,
    path: options?.path,
    method: options?.method,
    startTime: Date.now(),
  };
}

/**
 * Create a child logger bound to a request context
 */
export function createRequestLogger(ctx: RequestContext): Logger {
  return logger.child({
    traceId: ctx.traceId,
    ...(ctx.tenantSlug && { tenant: ctx.tenantSlug }),
    ...(ctx.path && { path: ctx.path }),
    ...(ctx.method && { method: ctx.method }),
  });
}

// =============================================================================
// Layer-Specific Loggers
// =============================================================================

/**
 * Create a child logger for a specific layer
 */
export function createLayerLogger(
  layer: 'api' | 'rag' | 'db' | 'external' | 'security' | 'admin',
  ctx?: RequestContext
): Logger {
  const base = ctx ? createRequestLogger(ctx) : logger;
  return base.child({ layer });
}

/**
 * Pre-configured layer loggers (without request context)
 */
export const loggers = {
  api: logger.child({ layer: 'api' }),
  rag: logger.child({ layer: 'rag' }),
  db: logger.child({ layer: 'db' }),
  external: logger.child({ layer: 'external' }),
  security: logger.child({ layer: 'security' }),
  admin: logger.child({ layer: 'admin' }),
};

// =============================================================================
// Sanitization Utilities
// =============================================================================

/**
 * Maximum length for text content in logs
 */
const MAX_TEXT_LENGTH = 200;
const MAX_EMBEDDING_PREVIEW = 5;

/**
 * Patterns for detecting sensitive data
 */
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI API keys
  /sbp_[a-zA-Z0-9]{20,}/g, // Supabase access tokens
  /postgres:\/\/[^@]+@/g, // Database URLs with credentials
  /Bearer [a-zA-Z0-9._-]+/g, // Bearer tokens
  /password[=:]\s*["']?[^"'\s]+/gi, // Password values
  /api[_-]?key[=:]\s*["']?[^"'\s]+/gi, // API key values
];

/**
 * Sanitize a string by redacting sensitive patterns
 */
export function sanitizeString(value: string): string {
  let sanitized = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

/**
 * Truncate text content for logging
 */
export function truncateText(text: string, maxLength = MAX_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... (${text.length} chars total)`;
}

/**
 * Sanitize embedding vectors (show only preview)
 */
export function sanitizeEmbedding(
  embedding: number[]
): { preview: number[]; dimensions: number } {
  return {
    preview: embedding.slice(0, MAX_EMBEDDING_PREVIEW),
    dimensions: embedding.length,
  };
}

/**
 * Sanitize an object for logging
 */
export function sanitizeForLogging<T extends Record<string, unknown>>(
  obj: T,
  options?: {
    truncateKeys?: string[];
    redactKeys?: string[];
  }
): Record<string, unknown> {
  const { truncateKeys = [], redactKeys = [] } = options || {};
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Redact sensitive keys entirely
    if (redactKeys.includes(key)) {
      result[key] = '[REDACTED]';
      continue;
    }

    // Handle different value types
    if (typeof value === 'string') {
      // Truncate specified keys
      if (truncateKeys.includes(key)) {
        result[key] = truncateText(value);
      } else {
        result[key] = sanitizeString(value);
      }
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
      // Likely an embedding vector
      result[key] = sanitizeEmbedding(value as number[]);
    } else if (value && typeof value === 'object') {
      // Recursively sanitize nested objects
      result[key] = sanitizeForLogging(value as Record<string, unknown>, options);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// =============================================================================
// Timing Utilities
// =============================================================================

/**
 * Timing information for debug responses
 */
export interface TimingInfo {
  traceId: string;
  retrieval_ms?: number;
  embedding_ms?: number;
  llm_ms?: number;
  db_ms?: number;
  total_ms: number;
}

/**
 * Timer class for tracking operation durations
 */
export class Timer {
  private startTime: number;
  private marks: Map<string, number> = new Map();
  private durations: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Mark the start of an operation
   */
  mark(name: string): void {
    this.marks.set(name, Date.now());
  }

  /**
   * Record the duration since a mark
   */
  measure(name: string): number {
    const markTime = this.marks.get(name);
    if (!markTime) {
      return 0;
    }
    const duration = Date.now() - markTime;
    this.durations.set(name, duration);
    return duration;
  }

  /**
   * Get a specific duration
   */
  getDuration(name: string): number | undefined {
    return this.durations.get(name);
  }

  /**
   * Get total elapsed time
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all durations as an object
   */
  getAllDurations(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of this.durations) {
      result[`${key}_ms`] = value;
    }
    return result;
  }

  /**
   * Generate timing info for API response
   */
  toTimingInfo(traceId: string): TimingInfo {
    return {
      traceId,
      ...this.getAllDurations(),
      total_ms: this.elapsed(),
    };
  }
}

// =============================================================================
// Logging Helpers
// =============================================================================

/**
 * Log an API request start
 */
export function logRequestStart(
  log: Logger,
  req: { method?: string; url?: string; headers?: Record<string, string> }
): void {
  log.info(
    {
      event: 'request_start',
      userAgent: req.headers?.['user-agent'],
    },
    `${req.method} ${req.url}`
  );
}

/**
 * Log an API request completion
 */
export function logRequestEnd(
  log: Logger,
  status: number,
  durationMs: number
): void {
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  log[level](
    {
      event: 'request_end',
      status,
      duration_ms: durationMs,
    },
    `Request completed with status ${status}`
  );
}

/**
 * Log a database operation
 */
export function logDbOperation(
  log: Logger,
  operation: string,
  details: {
    table?: string;
    rows?: number;
    duration_ms: number;
    error?: string;
  }
): void {
  if (details.error) {
    log.error(
      {
        event: 'db_operation',
        operation,
        ...details,
      },
      `Database ${operation} failed: ${details.error}`
    );
  } else {
    log.debug(
      {
        event: 'db_operation',
        operation,
        ...details,
      },
      `Database ${operation} completed`
    );
  }
}

/**
 * Log an external service call
 */
export function logExternalCall(
  log: Logger,
  service: 'openai' | 'supabase' | 'other',
  operation: string,
  details: {
    duration_ms?: number;
    status?: number | string;
    error?: string;
    tokens?: number;
    model?: string;
  }
): void {
  const baseLog = {
    event: 'external_call',
    service,
    operation,
    ...details,
  };

  if (details.error) {
    log.error(baseLog, `${service} ${operation} failed: ${details.error}`);
  } else {
    log.debug(baseLog, `${service} ${operation} completed`);
  }
}

/**
 * Log a security event
 */
export function logSecurityEvent(
  log: Logger,
  event: 'prompt_injection' | 'suspicious_input' | 'low_confidence' | 'rate_limit',
  details: {
    input?: string;
    confidence?: number;
    reason?: string;
  }
): void {
  log.warn(
    {
      event: `security_${event}`,
      ...details,
      input: details.input ? truncateText(details.input, 100) : undefined,
    },
    `Security event: ${event}`
  );
}

/**
 * Log RAG pipeline step
 */
export function logRagStep(
  log: Logger,
  step: 'embedding' | 'retrieval' | 'reranking' | 'generation' | 'citation',
  details: {
    duration_ms?: number;
    chunks?: number;
    tokens?: number;
    confidence?: number;
    model?: string;
    error?: string;
  }
): void {
  const baseLog = {
    event: `rag_${step}`,
    ...details,
  };

  if (details.error) {
    log.error(baseLog, `RAG ${step} failed: ${details.error}`);
  } else {
    log.debug(baseLog, `RAG ${step} completed`);
  }
}

/**
 * Log admin action
 */
export function logAdminAction(
  log: Logger,
  action: string,
  details: {
    target?: string;
    count?: number;
    userId?: string;
  }
): void {
  log.info(
    {
      event: 'admin_action',
      action,
      ...details,
    },
    `Admin action: ${action}`
  );
}

// =============================================================================
// Export Types
// =============================================================================

export type { Logger } from 'pino';

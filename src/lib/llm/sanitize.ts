/**
 * Input Sanitization Utility
 *
 * Lightweight sanitization for user inputs and document content
 * to defend against prompt injection attacks.
 *
 * Defense strategies:
 * 1. Pattern detection - identify common injection patterns
 * 2. Character filtering - remove/escape potentially dangerous characters
 * 3. Length limiting - prevent token exhaustion attacks
 * 4. Structural markers - escape boundary markers that could confuse the model
 */

import { logger, truncateText as logTruncate } from '@/lib/logger';

// Create a child logger for security-related sanitization events
const log = logger.child({ layer: 'security', service: 'sanitize' });

// =============================================================================
// Configuration
// =============================================================================

/**
 * Maximum allowed input lengths to prevent token exhaustion.
 */
export const MAX_LENGTHS = {
  USER_QUESTION: 2000,
  DOCUMENT_CONTENT: 10000,
  DOCUMENT_TITLE: 500,
} as const;

/**
 * Patterns that may indicate prompt injection attempts.
 * These are checked but not necessarily blocked - flagged for logging.
 */
const INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(everything|all|your)\s+(instructions?|rules?|training)/i,

  // Role manipulation
  /you\s+are\s+(now|actually|really)\s+(a|an|the)/i,
  /pretend\s+(to\s+be|you('re| are))/i,
  /act\s+as\s+(if\s+you('re| are)|a|an)/i,
  /roleplay\s+as/i,
  /your\s+new\s+(role|persona|identity)/i,

  // System prompt extraction
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?instructions/i,
  /what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions)/i,
  /output\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
  /print\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,

  // Delimiter/boundary attacks
  /<<<\s*(system|end|user|context)/i,
  />>>\s*(system|end|user|context)/i,
  /\[\[system\]\]/i,
  /##\s*system/i,

  // Code execution attempts
  /exec(ute)?\s*\(/i,
  /eval\s*\(/i,
  /import\s+os/i,
  /subprocess/i,
  /__import__/i,

  // Jailbreak patterns
  /do\s+anything\s+now/i,
  /dan\s+mode/i,
  /jailbreak/i,
  /bypass\s+(safety|filter|restrictions)/i,
  /unlock\s+(your|full)\s+(potential|capabilities)/i,
];

/**
 * Characters and sequences to escape or remove.
 */
const ESCAPE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Escape angle bracket sequences used in boundary markers
  { pattern: /<<<+/g, replacement: '< < <' },
  { pattern: />>>+/g, replacement: '> > >' },

  // Escape markdown-style headers that might be interpreted as instructions
  { pattern: /^#{1,6}\s*(system|instruction|prompt|rule)/gim, replacement: '(heading) $1' },

  // Escape potential XML/HTML-like tags
  { pattern: /<\/?system>/gi, replacement: '[system]' },
  { pattern: /<\/?instruction>/gi, replacement: '[instruction]' },
  { pattern: /<\/?prompt>/gi, replacement: '[prompt]' },

  // Remove null bytes and other control characters (except newlines and tabs)
  { pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, replacement: '' },

  // Normalize excessive whitespace (but preserve paragraph breaks)
  { pattern: /[ \t]{10,}/g, replacement: '    ' },
  { pattern: /\n{5,}/g, replacement: '\n\n\n' },
];

// =============================================================================
// Types
// =============================================================================

export interface SanitizeResult {
  sanitized: string;
  original: string;
  truncated: boolean;
  injectionDetected: boolean;
  detectedPatterns: string[];
}

export interface SanitizeOptions {
  maxLength?: number;
  detectInjection?: boolean;
  escapePatterns?: boolean;
  logDetections?: boolean;
}

// =============================================================================
// Core Sanitization Functions
// =============================================================================

/**
 * Detect potential injection patterns in text.
 * Returns list of detected pattern descriptions.
 */
export function detectInjectionPatterns(text: string): string[] {
  const detected: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      // Get a readable description from the pattern
      const desc = pattern.source
        .replace(/\\s\+/g, ' ')
        .replace(/\[^\\w\]\+/g, '')
        .replace(/\(.*?\)/g, '')
        .slice(0, 50);
      detected.push(desc);
    }
  }

  return detected;
}

/**
 * Apply escape patterns to neutralize potentially dangerous sequences.
 */
export function applyEscapePatterns(text: string): string {
  let result = text;

  for (const { pattern, replacement } of ESCAPE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Truncate text to maximum length, preferring to break at word boundaries.
 */
export function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  // Try to break at a word boundary
  let truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    truncated = truncated.slice(0, lastSpace);
  }

  return { text: truncated + '...', truncated: true };
}

/**
 * Full sanitization pipeline for any text input.
 */
export function sanitize(
  text: string,
  options: SanitizeOptions = {}
): SanitizeResult {
  const {
    maxLength = MAX_LENGTHS.USER_QUESTION,
    detectInjection = true,
    escapePatterns = true,
    logDetections = true,
  } = options;

  const original = text;
  let sanitized = text.trim();
  let detectedPatterns: string[] = [];

  // Step 1: Detect injection patterns (before any modification)
  if (detectInjection) {
    detectedPatterns = detectInjectionPatterns(sanitized);

    if (logDetections && detectedPatterns.length > 0) {
      log.warn(
        { event: 'injection_patterns_detected', patterns: detectedPatterns, input: logTruncate(sanitized, 100) },
        'Potential injection patterns detected'
      );
    }
  }

  // Step 2: Apply escape patterns
  if (escapePatterns) {
    sanitized = applyEscapePatterns(sanitized);
  }

  // Step 3: Truncate to max length
  const { text: truncatedText, truncated } = truncateText(sanitized, maxLength);
  sanitized = truncatedText;

  return {
    sanitized,
    original,
    truncated,
    injectionDetected: detectedPatterns.length > 0,
    detectedPatterns,
  };
}

// =============================================================================
// Specialized Sanitizers
// =============================================================================

/**
 * Sanitize user question input.
 * More aggressive detection and length limits.
 */
export function sanitizeUserInput(question: string): string {
  const result = sanitize(question, {
    maxLength: MAX_LENGTHS.USER_QUESTION,
    detectInjection: true,
    escapePatterns: true,
    logDetections: true,
  });

  // If injection detected, we still return sanitized text
  // The LLM's system prompt will handle the actual defense
  return result.sanitized;
}

/**
 * Sanitize document content from the knowledge base.
 * Less aggressive since this is "trusted" content, but still protected.
 */
export function sanitizeDocumentContent(content: string): string {
  const result = sanitize(content, {
    maxLength: MAX_LENGTHS.DOCUMENT_CONTENT,
    detectInjection: true,
    escapePatterns: true,
    logDetections: true,
  });

  return result.sanitized;
}

/**
 * Sanitize document title.
 */
export function sanitizeDocumentTitle(title: string): string {
  const result = sanitize(title, {
    maxLength: MAX_LENGTHS.DOCUMENT_TITLE,
    detectInjection: false,  // Titles are less risky
    escapePatterns: true,
    logDetections: false,
  });

  return result.sanitized;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Check if input is likely a legitimate question vs. an attack.
 * Returns a score from 0 (likely attack) to 1 (likely legitimate).
 */
export function assessInputLegitimacy(text: string): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 1.0;

  // Check for injection patterns
  const injectionPatterns = detectInjectionPatterns(text);
  if (injectionPatterns.length > 0) {
    score -= 0.3 * Math.min(injectionPatterns.length, 3);
    reasons.push(`Injection patterns detected: ${injectionPatterns.length}`);
  }

  // Check for excessive special characters
  const specialCharRatio = (text.match(/[<>{}[\]\\|`~^]/g) || []).length / text.length;
  if (specialCharRatio > 0.1) {
    score -= 0.2;
    reasons.push('High special character ratio');
  }

  // Check for very long inputs (potential token exhaustion)
  if (text.length > MAX_LENGTHS.USER_QUESTION * 0.8) {
    score -= 0.1;
    reasons.push('Near maximum length');
  }

  // Check for code-like patterns
  const codePatterns = /\b(function|const|let|var|import|export|class|def|return)\b/gi;
  const codeMatches = text.match(codePatterns) || [];
  if (codeMatches.length > 2) {
    score -= 0.15;
    reasons.push('Code-like patterns detected');
  }

  // Check for question-like structure (good sign)
  const hasQuestionWords = /^(what|who|when|where|why|how|can|is|are|do|does|did|will|would|should|could)/i.test(text.trim());
  const hasQuestionMark = text.includes('?');
  if (hasQuestionWords || hasQuestionMark) {
    score += 0.1;
    reasons.push('Question-like structure');
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    reasons,
  };
}

/**
 * Quick check if input should be blocked entirely.
 */
export function shouldBlockInput(text: string): {
  block: boolean;
  reason: string | null;
} {
  // Block empty or whitespace-only input
  if (!text.trim()) {
    return { block: true, reason: 'Empty input' };
  }

  // Block excessively long input
  if (text.length > MAX_LENGTHS.USER_QUESTION * 2) {
    return { block: true, reason: 'Input exceeds maximum length' };
  }

  // Block if legitimacy score is very low
  const { score } = assessInputLegitimacy(text);
  if (score < 0.3) {
    return { block: true, reason: 'Input appears to be an attack' };
  }

  return { block: false, reason: null };
}

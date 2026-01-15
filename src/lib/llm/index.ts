/**
 * LLM module exports.
 */

export { BaseLLMAdapter } from './adapter';
export type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMEmbeddingOptions,
  LLMEmbeddingResponse,
} from './adapter';

export { OpenAIAdapter } from './openai-adapter';

export {
  createLLMAdapter,
  createLLMAdapterFromConfig,
  getSupportedProviders,
  registerLLMAdapter,
  isProviderSupported,
} from './factory';

export {
  buildRAGSystemPrompt,
  buildRAGUserPrompt,
  buildConfidenceCheckPrompt,
  formatChunksAsContexts,
  FALLBACK_ANSWER,
} from './prompts';

export type { RetrievedContext } from './prompts';

// Sanitization utilities
export {
  sanitize,
  sanitizeUserInput,
  sanitizeDocumentContent,
  sanitizeDocumentTitle,
  detectInjectionPatterns,
  assessInputLegitimacy,
  shouldBlockInput,
  MAX_LENGTHS,
} from './sanitize';

export type { SanitizeResult, SanitizeOptions } from './sanitize';

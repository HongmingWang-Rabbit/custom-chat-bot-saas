/**
 * LLM Adapter Factory.
 *
 * Creates LLM adapters based on provider configuration.
 * Enables easy switching between providers without code changes.
 */

import { LLMAdapter, LLMAdapterConfig } from './adapter';
import { OpenAIAdapter } from './openai-adapter';
import { LLMProvider } from '@/types/database';

// =============================================================================
// Adapter Registry
// =============================================================================

type AdapterConstructor = new (config: LLMAdapterConfig) => LLMAdapter;

const adapterRegistry = new Map<LLMProvider, AdapterConstructor>([
  ['openai', OpenAIAdapter],
  // Add new adapters here:
  // ['anthropic', AnthropicAdapter],
  // ['azure', AzureOpenAIAdapter],
]);

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an LLM adapter for a specific provider.
 *
 * @param provider - LLM provider name
 * @param config - Adapter configuration
 * @returns LLM adapter instance
 * @throws Error if provider is not supported
 *
 * @example
 * const adapter = createLLMAdapter('openai', {
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   defaultModel: 'gpt-4o',
 * });
 */
export function createLLMAdapter(
  provider: LLMProvider,
  config: LLMAdapterConfig
): LLMAdapter {
  const AdapterClass = adapterRegistry.get(provider);

  if (!AdapterClass) {
    throw new Error(
      `Unsupported LLM provider: ${provider}. ` +
      `Supported providers: ${getSupportedProviders().join(', ')}`
    );
  }

  return new AdapterClass(config);
}

/**
 * Create an LLM adapter from tenant configuration.
 * Uses environment variables for API keys.
 *
 * @param llmProvider - Provider name from tenant config
 * @param tenantApiKey - Tenant's API key (optional, falls back to env)
 * @returns LLM adapter instance
 *
 * @example
 * const adapter = createLLMAdapterFromConfig('openai', tenant.llm_api_key);
 */
export function createLLMAdapterFromConfig(
  llmProvider: string,
  tenantApiKey?: string | null
): LLMAdapter {
  const provider = llmProvider as LLMProvider;
  const apiKey = tenantApiKey || getApiKeyForProvider(provider);

  return createLLMAdapter(provider, { apiKey });
}

/**
 * Get API key from environment for a provider.
 *
 * @param provider - LLM provider name
 * @returns API key
 * @throws Error if API key is not configured
 */
function getApiKeyForProvider(provider: LLMProvider): string {
  const keyMap: Record<LLMProvider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    azure: process.env.AZURE_OPENAI_API_KEY,
    custom: process.env.CUSTOM_LLM_API_KEY,
  };

  const key = keyMap[provider];

  if (!key) {
    throw new Error(
      `API key not found for provider: ${provider}. ` +
      `Set the appropriate environment variable.`
    );
  }

  return key;
}

// =============================================================================
// Registry Management
// =============================================================================

/**
 * Get list of supported LLM providers.
 */
export function getSupportedProviders(): LLMProvider[] {
  return Array.from(adapterRegistry.keys());
}

/**
 * Register a new LLM adapter.
 * Allows extending with custom providers.
 *
 * @param provider - Provider name
 * @param adapterClass - Adapter constructor
 *
 * @example
 * // Add a custom adapter
 * class MyCustomAdapter extends BaseLLMAdapter { ... }
 * registerLLMAdapter('custom', MyCustomAdapter);
 */
export function registerLLMAdapter(
  provider: LLMProvider,
  adapterClass: AdapterConstructor
): void {
  adapterRegistry.set(provider, adapterClass);
}

/**
 * Check if a provider is supported.
 *
 * @param provider - Provider name to check
 * @returns true if provider is supported
 */
export function isProviderSupported(provider: string): provider is LLMProvider {
  return adapterRegistry.has(provider as LLMProvider);
}

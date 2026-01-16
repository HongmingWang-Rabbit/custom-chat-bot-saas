'use client';

/**
 * useChat hook
 *
 * Manages chat state and handles streaming SSE responses from the Q&A API.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, CitationData, LoadingStatus } from '@/components/features/qa';

// Re-export LoadingStatus for consumers who import from this hook
export type { LoadingStatus };

// =============================================================================
// Types
// =============================================================================

interface UseChatOptions {
  tenantSlug: string;
  onError?: (error: string) => void;
}

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  loadingStatus: LoadingStatus;
  error: string | null;
  sendMessage: (question: string) => Promise<void>;
  clearMessages: () => void;
}

interface SSEData {
  content?: string;
  citations?: CitationData[];
  confidence?: number;
  retrievedChunks?: number;
  status?: 'searching' | 'generating';
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum buffer size for SSE parsing to prevent memory exhaustion (1MB) */
const MAX_BUFFER_SIZE = 1024 * 1024;

// =============================================================================
// Hook
// =============================================================================

export function useChat({ tenantSlug, onError }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string>(generateSessionId());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup: abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return;

      setError(null);
      setIsLoading(true);

      // Add user message
      const userMessageId = generateId();
      const assistantMessageId = generateId();

      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: 'user',
          content: question,
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          isStreaming: true,
        },
      ]);

      try {
        // Abort any previous request and create new controller
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        const response = await fetch('/api/qa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question,
            tenantSlug,
            sessionId: sessionIdRef.current,
            stream: true,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        // Process SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let citations: CitationData[] = [];
        let confidence: number | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Prevent memory exhaustion from malformed streams
          if (buffer.length > MAX_BUFFER_SIZE) {
            throw new Error('Stream buffer exceeded maximum size');
          }

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            // Skip event type lines (we handle all events the same way via data parsing)
            if (line.startsWith('event: ')) {
              continue;
            }

            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              try {
                const data: SSEData = JSON.parse(dataStr);

                if (data.content) {
                  fullContent += data.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: fullContent }
                        : msg
                    )
                  );
                }

                if (data.citations) {
                  citations = data.citations;
                }

                if (data.confidence !== undefined) {
                  confidence = data.confidence;
                }

                if (data.status) {
                  setLoadingStatus(data.status);
                }

                if (data.error) {
                  throw new Error(data.error);
                }
              } catch (parseError) {
                // Re-throw application errors (non-JSON parse errors)
                // SyntaxError is thrown by JSON.parse for malformed JSON
                const isJsonParseError = parseError instanceof SyntaxError;
                if (!isJsonParseError) {
                  throw parseError;
                }
                // Ignore JSON parse errors for incomplete/empty data chunks
                // These are expected during SSE streaming
              }
            }
          }
        }

        // Finalize message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: fullContent,
                  citations,
                  confidence,
                  isStreaming: false,
                }
              : msg
          )
        );
      } catch (err) {
        // Ignore abort errors (expected when component unmounts or request is cancelled)
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get response';
        setError(errorMessage);
        onError?.(errorMessage);

        // Update message with error
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: 'Sorry, I encountered an error processing your request. Please try again.',
                  isStreaming: false,
                }
              : msg
          )
        );
      } finally {
        setIsLoading(false);
        setLoadingStatus(null);
      }
    },
    [tenantSlug, isLoading, onError]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    sessionIdRef.current = generateSessionId();
  }, []);

  return {
    messages,
    isLoading,
    loadingStatus,
    error,
    sendMessage,
    clearMessages,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

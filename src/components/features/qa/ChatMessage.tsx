'use client';

/**
 * Chat message component.
 *
 * Displays user questions and assistant answers with streaming support.
 */

import { Citation } from './Citation';

// =============================================================================
// Types
// =============================================================================

export interface CitationData {
  id: string | number;
  documentTitle: string;
  snippet: string;
  confidence: number;
  source?: string;
}

export interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationData[];
  isStreaming?: boolean;
  confidence?: number;
}

// =============================================================================
// Component
// =============================================================================

export function ChatMessage({
  role,
  content,
  citations,
  isStreaming,
  confidence,
}: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          isUser
            ? 'bg-[var(--color-primary)] text-white'
            : 'bg-[var(--color-secondary)] text-white'
        }`}
      >
        {isUser ? 'Q' : 'A'}
      </div>

      {/* Message Content */}
      <div
        className={`flex-1 max-w-[80%] ${
          isUser ? 'text-right' : 'text-left'
        }`}
      >
        <div
          className={`inline-block px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-[var(--color-primary)] text-white rounded-tr-sm'
              : 'bg-gray-100 dark:bg-gray-800 rounded-tl-sm'
          }`}
        >
          <div className="prose prose-sm max-w-none">
            {content}
            {isStreaming && (
              <span className="cursor-blink ml-0.5 inline-block w-2 h-4 bg-current" />
            )}
          </div>
        </div>

        {/* Confidence indicator */}
        {!isUser && confidence !== undefined && !isStreaming && (
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            Confidence: {Math.round(confidence * 100)}%
          </div>
        )}

        {/* Citations */}
        {!isUser && citations && citations.length > 0 && !isStreaming && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-[var(--color-muted)]">
              Sources ({citations.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {citations.map((citation, idx) => (
                <Citation key={citation.id || idx} {...citation} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

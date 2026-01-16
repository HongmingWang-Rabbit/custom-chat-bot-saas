'use client';

import { useMemo, ReactNode } from 'react';

/**
 * Chat message component.
 *
 * Displays user questions and assistant answers with streaming support.
 */

// =============================================================================
// Types
// =============================================================================

export type LoadingStatus = 'searching' | 'generating' | null;

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
  loadingStatus?: LoadingStatus;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse content and replace [Citation N] with clickable chips.
 */
function renderContentWithCitations(
  content: string,
  citations: CitationData[] | undefined
): ReactNode {
  if (!citations || citations.length === 0) {
    return content;
  }

  // Build a map from citation number to citation data
  const citationMap = new Map<number, CitationData>();
  citations.forEach((c) => {
    const id = typeof c.id === 'string' ? parseInt(c.id, 10) : c.id;
    citationMap.set(id, c);
  });

  // Match [Citation N] pattern
  const regex = /\[Citation\s*(\d+)\]/gi;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add text before the citation
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const citationNum = parseInt(match[1], 10);
    const citation = citationMap.get(citationNum);

    if (citation) {
      // Truncate long file names
      const displayName = citation.documentTitle.length > 16
        ? citation.documentTitle.slice(0, 13) + '...'
        : citation.documentTitle;

      parts.push(
        citation.source ? (
          <a
            key={`citation-${match.index}`}
            href={citation.source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition cursor-pointer align-baseline"
            title={citation.documentTitle}
          >
            {displayName}
          </a>
        ) : (
          <span
            key={`citation-${match.index}`}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 rounded align-baseline"
            title={citation.documentTitle}
          >
            {displayName}
          </span>
        )
      );
    } else {
      // Keep original if citation not found
      parts.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

// =============================================================================
// Component
// =============================================================================

// Status messages for different loading states
const STATUS_MESSAGES: Record<Exclude<LoadingStatus, null>, string> = {
  searching: 'Searching knowledge base...',
  generating: 'Generating response...',
};

export function ChatMessage({
  role,
  content,
  citations,
  isStreaming,
  confidence,
  loadingStatus,
}: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div
      className={`flex gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      data-testid={isUser ? 'chat-message-user' : 'chat-message-assistant'}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold ${
          isUser
            ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
            : 'bg-gray-100 text-gray-600'
        }`}
      >
        {isUser ? 'Q' : 'A'}
      </div>

      {/* Message Content */}
      <div className={`flex-1 max-w-[85%] ${isUser ? 'text-right' : 'text-left'}`}>
        {/* Label */}
        <p className={`text-xs font-medium mb-1 ${isUser ? 'text-blue-600' : 'text-gray-400'}`}>
          {isUser ? 'You' : 'Assistant'}
        </p>

        {/* Message bubble */}
        <div
          className={`inline-block px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-tr-md'
              : 'bg-white border border-gray-200 text-gray-700 rounded-tl-md shadow-sm'
          }`}
        >
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            {isUser || isStreaming
              ? content
              : renderContentWithCitations(content, citations)}
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse rounded-sm" />
            )}
          </div>
        </div>

        {/* Loading status indicator */}
        {!isUser && isStreaming && loadingStatus && (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
            <svg
              className="w-4 h-4 animate-spin text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>{STATUS_MESSAGES[loadingStatus]}</span>
          </div>
        )}

        {/* Confidence indicator - only show when confidence > 0 (not for conversational responses) */}
        {!isUser && confidence !== undefined && confidence > 0 && !isStreaming && (
          <div className="mt-2 flex items-center gap-2">
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
              confidence >= 0.8
                ? 'bg-green-100 text-green-700'
                : confidence >= 0.6
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-red-100 text-red-700'
            }`}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              {Math.round(confidence * 100)}% confidence
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

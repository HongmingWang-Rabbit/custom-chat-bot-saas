'use client';

import { useMemo, ReactNode } from 'react';

/**
 * Chat message component.
 *
 * Displays user questions and assistant answers with streaming support.
 */

// =============================================================================
// Constants
// =============================================================================

/** Maximum length for citation display name before truncation */
const CITATION_MAX_DISPLAY_LENGTH = 16;

/** Length to truncate citation display name to (with ellipsis) */
const CITATION_TRUNCATE_LENGTH = 13;

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
 * Deduplicates citations within the same paragraph.
 *
 * @param content - The text content containing [Citation N] markers
 * @param citations - Array of citation data to map markers to
 * @returns React nodes with citation markers replaced by clickable chips
 */
function renderContentWithCitations(
  content: string,
  citations: CitationData[] | undefined
): ReactNode {
  // Return plain content if no citations
  if (!citations || citations.length === 0) {
    return content;
  }

  try {
    // Build a map from citation number to citation data
    const citationMap = new Map<number, CitationData>();
    citations.forEach((c) => {
      const id = typeof c.id === 'string' ? parseInt(c.id, 10) : c.id;
      if (!isNaN(id)) {
        citationMap.set(id, c);
      }
    });

    // Split content into paragraphs, process each, then rejoin
    const paragraphs = content.split(/(\n\n+)/);

    const processedParagraphs = paragraphs.map((paragraph, paragraphIndex) => {
      // If this is a separator (newlines), just return it
      if (/^\n+$/.test(paragraph)) {
        return paragraph;
      }

      // Track which document titles have been shown in this paragraph
      const shownDocuments = new Set<string>();

      // Match [Citation N] pattern
      const regex = /\[Citation\s*(\d+)\]/gi;
      const parts: ReactNode[] = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(paragraph)) !== null) {
        // Add text before the citation
        if (match.index > lastIndex) {
          parts.push(paragraph.slice(lastIndex, match.index));
        }

        const citationNum = parseInt(match[1], 10);
        const citation = citationMap.get(citationNum);

        if (citation) {
          // Check if we've already shown this document in this paragraph
          if (shownDocuments.has(citation.documentTitle)) {
            // Skip duplicate - don't add anything
            lastIndex = match.index + match[0].length;
            continue;
          }

          // Mark this document as shown
          shownDocuments.add(citation.documentTitle);

          // Truncate long file names using constants
          const displayName = citation.documentTitle.length > CITATION_MAX_DISPLAY_LENGTH
            ? citation.documentTitle.slice(0, CITATION_TRUNCATE_LENGTH) + '...'
            : citation.documentTitle;

          parts.push(
            <span key={`citation-${paragraphIndex}-${match.index}`} className="relative inline-block group">
              {citation.source ? (
                <a
                  href={citation.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition cursor-pointer align-baseline"
                >
                  {displayName}
                </a>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 rounded align-baseline">
                  {displayName}
                </span>
              )}
              {/* Tooltip showing full document title */}
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                {citation.documentTitle}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
              </span>
            </span>
          );
        } else {
          // Keep original if citation not found
          parts.push(match[0]);
        }

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < paragraph.length) {
        parts.push(paragraph.slice(lastIndex));
      }

      return parts.length > 0 ? parts : paragraph;
    });

    // Flatten the array of paragraphs
    return processedParagraphs.flat();
  } catch (error) {
    // If citation rendering fails, fall back to plain text
    console.error('Failed to render citations:', error);
    return content;
  }
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

  // Memoize citation rendering to avoid re-computing on every render
  const renderedContent = useMemo(() => {
    if (isUser || isStreaming) {
      return content;
    }
    return renderContentWithCitations(content, citations);
  }, [content, citations, isUser, isStreaming]);

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
            {renderedContent}
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

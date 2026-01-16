'use client';

import { useMemo, ReactNode, Component, ErrorInfo } from 'react';
import ReactMarkdown from 'react-markdown';

/**
 * Chat message component.
 *
 * Displays user questions and assistant answers with streaming support.
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum length for citation display name before truncation.
 * Chosen to fit nicely in the inline chip without wrapping on mobile.
 */
const CITATION_MAX_DISPLAY_LENGTH = 16;

/**
 * Length to truncate citation display name to (with ellipsis).
 * Leaves room for "..." (3 chars) within the max display length.
 */
const CITATION_TRUNCATE_LENGTH = 13;

/**
 * Regex pattern to match citation formats in LLM responses.
 * Matches both "[Citation N]" and "[N]" formats where N is a number.
 * Global and case-insensitive to catch all variations.
 */
const CITATION_REGEX = /\[Citation\s*(\d+)\]|\[(\d+)\]/gi;

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
// Error Boundary
// =============================================================================

interface MarkdownErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface MarkdownErrorBoundaryState {
  hasError: boolean;
}

/**
 * Error boundary to catch markdown rendering errors.
 * Falls back to plain text if ReactMarkdown throws.
 */
class MarkdownErrorBoundary extends Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  constructor(props: MarkdownErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): MarkdownErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Markdown rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a citation map from an array of citations.
 */
function buildCitationMap(citations: CitationData[]): Map<number, CitationData> {
  const map = new Map<number, CitationData>();
  citations.forEach((c) => {
    const id = typeof c.id === 'string' ? parseInt(c.id, 10) : c.id;
    if (!isNaN(id)) {
      map.set(id, c);
    }
  });
  return map;
}

/**
 * Render a citation chip with tooltip.
 */
function CitationChip({
  citation,
  uniqueKey,
}: {
  citation: CitationData;
  uniqueKey: string;
}) {
  const displayName = citation.documentTitle.length > CITATION_MAX_DISPLAY_LENGTH
    ? citation.documentTitle.slice(0, CITATION_TRUNCATE_LENGTH) + '...'
    : citation.documentTitle;

  return (
    <span key={uniqueKey} className="relative inline-block group">
      {citation.source ? (
        <a
          href={citation.source}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="chat-citation"
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition cursor-pointer align-baseline"
        >
          {displayName}
        </a>
      ) : (
        <span
          data-testid="chat-citation"
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 rounded align-baseline"
        >
          {displayName}
        </span>
      )}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
        {citation.documentTitle}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </span>
  );
}

/**
 * Parse text and replace [Citation N] with clickable chips.
 * Used for inline text processing within markdown.
 */
function processTextWithCitations(
  text: string,
  citationMap: Map<number, CitationData>,
  keyPrefix: string
): ReactNode[] {
  // Create a new regex instance to avoid lastIndex state issues with global regex
  const regex = new RegExp(CITATION_REGEX.source, CITATION_REGEX.flags);
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // match[1] is from [Citation N], match[2] is from [N]
    const citationNum = parseInt(match[1] || match[2], 10);
    const citation = citationMap.get(citationNum);

    if (citation) {
      parts.push(
        <CitationChip
          key={`${keyPrefix}-${match.index}`}
          citation={citation}
          uniqueKey={`${keyPrefix}-${match.index}`}
        />
      );
    } else {
      // Keep original text if citation not found
      parts.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/**
 * Create a key generator for unique React keys within a render cycle.
 * Encapsulates the counter to avoid mutable variable issues.
 */
function createKeyGenerator() {
  let counter = 0;
  return (prefix: string) => `${prefix}-${counter++}`;
}

/**
 * Render markdown content with citation support.
 * Citations like [Citation 1] are replaced with clickable chips.
 */
function MarkdownWithCitations({
  content,
  citations,
}: {
  content: string;
  citations: CitationData[] | undefined;
}): ReactNode {
  const citationMap = citations ? buildCitationMap(citations) : new Map<number, CitationData>();
  const generateKey = createKeyGenerator();

  return (
    <ReactMarkdown
      components={{
        // Process text nodes to replace citations
        p: ({ children }) => {
          const processed = processChildren(children, citationMap, generateKey('p'));
          return <p className="mb-3 last:mb-0">{processed}</p>;
        },
        li: ({ children }) => {
          const processed = processChildren(children, citationMap, generateKey('li'));
          return <li>{processed}</li>;
        },
        strong: ({ children }) => {
          const processed = processChildren(children, citationMap, generateKey('strong'));
          return <strong className="font-semibold">{processed}</strong>;
        },
        em: ({ children }) => {
          const processed = processChildren(children, citationMap, generateKey('em'));
          return <em>{processed}</em>;
        },
        // Style other markdown elements
        h1: ({ children }) => <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
        code: ({ className, children }) => {
          const isInline = !className;
          if (isInline) {
            return <code className="px-1.5 py-0.5 bg-gray-100 text-gray-800 rounded text-sm font-mono">{children}</code>;
          }
          return (
            <pre className="bg-gray-100 rounded-lg p-3 overflow-x-auto mb-3">
              <code className="text-sm font-mono text-gray-800">{children}</code>
            </pre>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-600 mb-3">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="min-w-full border-collapse border border-gray-300">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-gray-300 px-3 py-2 bg-gray-100 font-semibold text-left">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-300 px-3 py-2">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * Process children nodes to handle citations in text.
 */
function processChildren(
  children: ReactNode,
  citationMap: Map<number, CitationData>,
  keyPrefix: string
): ReactNode {
  if (typeof children === 'string') {
    return processTextWithCitations(children, citationMap, keyPrefix);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        return processTextWithCitations(child, citationMap, `${keyPrefix}-${i}`);
      }
      return child;
    });
  }
  return children;
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

  // Memoize markdown rendering to avoid re-computing on every render
  const renderedContent = useMemo(() => {
    // User messages: plain text, no markdown
    if (role === 'user') {
      return content;
    }
    // Assistant messages: render markdown with citations, wrapped in error boundary
    return (
      <MarkdownErrorBoundary fallback={<span className="whitespace-pre-wrap">{content}</span>}>
        <MarkdownWithCitations content={content} citations={citations} />
      </MarkdownErrorBoundary>
    );
  }, [content, citations, role]);

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
          <div className={`max-w-none text-sm leading-relaxed ${isUser ? 'whitespace-pre-wrap' : ''}`}>
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

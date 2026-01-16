'use client';

/**
 * Chat message component.
 *
 * Displays user questions and assistant answers with streaming support.
 */

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
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
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
            {content}
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse rounded-sm" />
            )}
          </div>
        </div>

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
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              {Math.round(confidence * 100)}% confidence
            </div>
          </div>
        )}

        {/* Source Documents - Show unique documents with download links */}
        {!isUser && citations && citations.length > 0 && !isStreaming && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Source Documents
            </p>
            <div className="space-y-2">
              {/* Get unique documents by title */}
              {Array.from(
                new Map(citations.map(c => [c.documentTitle, c])).values()
              ).map((citation, idx) => (
                <div
                  key={citation.id || idx}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{citation.documentTitle}</p>
                      <p className="text-xs text-gray-500">
                        {Math.round(citation.confidence * 100)}% relevance
                      </p>
                    </div>
                  </div>
                  {citation.source && (
                    <a
                      href={citation.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

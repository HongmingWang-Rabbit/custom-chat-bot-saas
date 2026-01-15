'use client';

/**
 * Chat container component.
 *
 * Full chat interface with message history and streaming support.
 */

import { useRef, useEffect } from 'react';
import { ChatMessage, CitationData } from './ChatMessage';
import { ChatInput } from './ChatInput';

// =============================================================================
// Types
// =============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationData[];
  confidence?: number;
  isStreaming?: boolean;
}

export interface ChatContainerProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (question: string) => void;
  tenantName?: string;
}

// =============================================================================
// Component
// =============================================================================

export function ChatContainer({
  messages,
  isLoading,
  onSendMessage,
  tenantName,
}: ChatContainerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--color-border)]">
        <h1 className="text-lg font-semibold">
          {tenantName ? `${tenantName} Q&A` : 'Investor Q&A'}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Ask questions about company disclosures and documents
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                citations={message.citations}
                confidence={message.confidence}
                isStreaming={message.isStreaming}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-[var(--color-border)]">
        <div className="max-w-3xl mx-auto">
          <ChatInput onSubmit={onSendMessage} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Empty State
// =============================================================================

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-[var(--color-primary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold mb-2">Ask a Question</h2>
      <p className="text-[var(--color-muted)] max-w-md mb-6">
        Get instant answers from our knowledge base with citations to source documents.
      </p>
      <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
        <p>Try asking:</p>
        <ul className="space-y-1">
          <li>&ldquo;What are the key risk factors?&rdquo;</li>
          <li>&ldquo;Summarize the financial performance&rdquo;</li>
          <li>&ldquo;What is the company&apos;s growth strategy?&rdquo;</li>
        </ul>
      </div>
    </div>
  );
}

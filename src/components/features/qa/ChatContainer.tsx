'use client';

/**
 * Chat container component.
 *
 * Full chat interface with message history and streaming support.
 */

import { useRef, useEffect } from 'react';
import { ChatMessage, CitationData, LoadingStatus } from './ChatMessage';
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
  loadingStatus?: LoadingStatus;
  onSendMessage: (question: string) => void;
  tenantName?: string;
}

// =============================================================================
// Component
// =============================================================================

export function ChatContainer({
  messages,
  isLoading,
  loadingStatus,
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
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary-tint">
            <svg
              className="w-5 h-5 text-primary-theme"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900">
              {tenantName ? `${tenantName} Q&A` : 'Investor Q&A'}
            </h1>
            <p className="text-sm text-gray-500">
              Ask questions about company disclosures and documents
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <EmptyState onSelectQuestion={onSendMessage} />
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                citations={message.citations}
                confidence={message.confidence}
                isStreaming={message.isStreaming}
                loadingStatus={message.isStreaming ? loadingStatus : undefined}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
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

function EmptyState({ onSelectQuestion }: { onSelectQuestion: (question: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <div className="w-20 h-20 mb-6 rounded-2xl flex items-center justify-center gradient-primary shadow-primary">
        <svg
          className="w-10 h-10 text-white"
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
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">Ask a Question</h2>
      <p className="text-gray-500 max-w-md mb-8">
        Get instant answers from our knowledge base with citations to source documents.
      </p>

      {/* Example questions */}
      <div className="w-full max-w-md">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Try asking
        </p>
        <div className="space-y-2">
          <ExampleQuestion text="What are the key risk factors?" onClick={onSelectQuestion} />
          <ExampleQuestion text="Summarize the financial performance" onClick={onSelectQuestion} />
          <ExampleQuestion text="What is the company's growth strategy?" onClick={onSelectQuestion} />
        </div>
      </div>
    </div>
  );
}

function ExampleQuestion({ text, onClick }: { text: string; onClick: (question: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(text)}
      className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-sm text-gray-700 text-left cursor-pointer transition"
    >
      <span className="text-primary-theme mr-2">&ldquo;</span>
      {text}
      <span className="text-primary-theme ml-1">&rdquo;</span>
    </button>
  );
}

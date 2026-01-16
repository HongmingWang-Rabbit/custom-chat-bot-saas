'use client';

/**
 * Chat input component.
 *
 * Text input with submit button for Q&A queries.
 */

import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface ChatInputProps {
  onSubmit: (question: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

// =============================================================================
// Component
// =============================================================================

export function ChatInput({
  onSubmit,
  disabled = false,
  placeholder = 'Ask a question about the documents...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed && !disabled) {
      onSubmit(trimmed);
      setValue('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-end gap-3 p-3 bg-white border border-gray-200 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          data-testid="chat-input"
          className="flex-1 resize-none bg-transparent border-none outline-none px-1 py-1 text-sm text-gray-700 placeholder:text-gray-400 disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={disabled || !value.trim()}
          data-testid="chat-submit"
          className="flex-shrink-0 p-2.5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
          aria-label="Send message"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>

      {/* Loading overlay */}
      {disabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500" data-testid="chat-loading">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
            <span>Generating response...</span>
          </div>
        </div>
      )}

      {/* Hint */}
      <p className="mt-2 text-xs text-gray-400 text-center">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}

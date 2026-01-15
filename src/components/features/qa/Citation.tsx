'use client';

/**
 * Citation component.
 *
 * Displays a citation reference with hover tooltip showing snippet.
 */

import { useState } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface CitationProps {
  id: string | number;
  documentTitle: string;
  snippet: string;
  confidence: number;
  source?: string;
}

// =============================================================================
// Component
// =============================================================================

export function Citation({
  documentTitle,
  snippet,
  confidence,
  source,
}: CitationProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Confidence color
  const confidenceColor =
    confidence >= 0.8
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : confidence >= 0.6
      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
      : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Citation badge */}
      <button
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-[var(--color-border)] hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${confidenceColor}`}
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span className="max-w-[150px] truncate">{documentTitle}</span>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-50 left-0 top-full mt-2 w-72 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-[var(--color-border)]">
          <p className="font-medium text-sm mb-2">{documentTitle}</p>
          <p className="text-xs text-[var(--color-muted)] mb-2 line-clamp-4">
            {snippet}
          </p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-muted)]">
              Match: {Math.round(confidence * 100)}%
            </span>
            {source && (
              <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                View source
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

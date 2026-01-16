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

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Citation badge */}
      <button
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"
      >
        <svg
          className="w-3.5 h-3.5"
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
        <span className="max-w-[120px] truncate">{documentTitle}</span>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-50 left-0 top-full mt-2 w-80 p-4 bg-white rounded-xl shadow-xl border border-gray-200 animate-in fade-in-0 zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-sm text-gray-900">{documentTitle}</p>
              <div className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                confidence >= 0.8
                  ? 'bg-green-100 text-green-700'
                  : confidence >= 0.6
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {Math.round(confidence * 100)}% match
              </div>
            </div>
          </div>

          {/* Snippet */}
          <div className="p-3 bg-gray-50 rounded-lg mb-3">
            <p className="text-xs text-gray-600 line-clamp-4 leading-relaxed">
              {snippet}
            </p>
          </div>

          {/* Footer */}
          {source && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition"
            >
              View source document
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

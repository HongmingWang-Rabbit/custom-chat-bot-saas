'use client';

/**
 * Modal for viewing document details
 */

import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { Document } from './types';

export interface DocumentViewModalProps {
  document: Document;
  tenantSlug: string;
  onClose: () => void;
}

export function DocumentViewModal({
  document,
  tenantSlug,
  onClose,
}: DocumentViewModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchContent() {
      try {
        const response = await fetch(`/api/documents/${document.id}?tenantSlug=${tenantSlug}`);
        if (response.ok) {
          const data = await response.json();
          setContent(data.document?.content || null);
        }
      } catch (err) {
        toast.error('Failed to load document details');
      } finally {
        setIsLoading(false);
      }
    }
    fetchContent();
  }, [document.id, tenantSlug]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex-1 min-w-0 mr-4">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{document.title}</h2>
            <p className="text-sm text-gray-500">{document.docType} • {document.chunkCount} chunks</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : content ? (
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 p-4 rounded-lg">
              {content}
            </pre>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Status:</span>
                  <span className="ml-2 font-medium text-gray-900">{document.status}</span>
                </div>
                <div>
                  <span className="text-gray-500">Chunks:</span>
                  <span className="ml-2 font-medium text-gray-900">{document.chunkCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">File Size:</span>
                  <span className="ml-2 font-medium text-gray-900">{document.fileSize ? `${(document.fileSize / 1024).toFixed(1)} KB` : '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Created:</span>
                  <span className="ml-2 font-medium text-gray-900">{new Date(document.createdAt).toLocaleString()}</span>
                </div>
              </div>
              <p className="text-sm text-gray-500 italic">Document content is stored in chunks for efficient retrieval.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

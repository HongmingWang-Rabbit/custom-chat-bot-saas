'use client';

/**
 * Document card component with actions
 */

import { useState } from 'react';
import { toast } from 'react-toastify';
import { Document } from './types';
import { STATUS_COLORS, formatFileSize } from './constants';
import { ConfirmModal } from './ConfirmModal';
import { DocumentViewModal } from './DocumentViewModal';
import { DocumentEditModal } from './DocumentEditModal';

export interface DocumentCardProps {
  document: Document;
  tenantSlug: string;
  onDeleted: () => void;
  onUpdated: () => void;
}

export function DocumentCard({
  document,
  tenantSlug,
  onDeleted,
  onUpdated,
}: DocumentCardProps) {
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDownload = async () => {
    try {
      const response = await fetch(`/api/documents/${document.id}/download?tenantSlug=${tenantSlug}`);
      if (response.ok) {
        const data = await response.json();
        window.open(data.download.url, '_blank');
      }
    } catch (err) {
      toast.error('Failed to download file');
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/documents/${document.id}?tenantSlug=${tenantSlug}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        toast.success('Document deleted');
        onDeleted();
      } else {
        toast.error('Failed to delete document');
      }
    } catch (err) {
      toast.error('Failed to delete document');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-gray-900 truncate" title={document.title}>{document.title}</h3>
            <p className="text-sm text-gray-500">{document.docType}</p>
          </div>
          <span className={`px-2 py-1 text-xs font-medium rounded-full flex-shrink-0 ${STATUS_COLORS[document.status] || 'bg-gray-100 text-gray-700'}`}>
            {document.status}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
          <div className="flex items-center gap-3">
            <span>{document.chunkCount} chunks</span>
            <span>{formatFileSize(document.fileSize)}</span>
          </div>
          <span>{new Date(document.createdAt).toLocaleDateString()}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-1 pt-3 border-t border-gray-100">
          <button
            onClick={() => setShowViewModal(true)}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
            title="View Details"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={() => setShowEditModal(true)}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {document.hasOriginalFile && (
            <button
              onClick={handleDownload}
              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
              title="Download"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* View Modal */}
      {showViewModal && (
        <DocumentViewModal
          document={document}
          tenantSlug={tenantSlug}
          onClose={() => setShowViewModal(false)}
        />
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <DocumentEditModal
          document={document}
          tenantSlug={tenantSlug}
          onClose={() => setShowEditModal(false)}
          onUpdated={() => {
            setShowEditModal(false);
            onUpdated();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Document"
          message={`Are you sure you want to delete "${document.title}"? This will also delete all associated chunks and cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

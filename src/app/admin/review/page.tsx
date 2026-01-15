'use client';

/**
 * Q&A Review Page
 *
 * Lists Q&A interactions for review with filtering and flagging capabilities.
 */

import { useState, useEffect, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

interface QALog {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  flagged: boolean;
  flaggedAt: string | null;
  flaggedReason: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  createdAt: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// =============================================================================
// Page Component
// =============================================================================

export default function ReviewPage() {
  const [logs, setLogs] = useState<QALog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<QALog | null>(null);

  // Filters
  const [tenantSlug, setTenantSlug] = useState('');
  const [filterFlagged, setFilterFlagged] = useState<'all' | 'true' | 'false'>('all');
  const [filterReviewed, setFilterReviewed] = useState<'all' | 'true' | 'false'>('all');

  const fetchLogs = useCallback(async () => {
    if (!tenantSlug) {
      setLogs([]);
      setPagination(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ tenantSlug });
      if (filterFlagged !== 'all') params.set('flagged', filterFlagged);
      if (filterReviewed !== 'all') params.set('reviewed', filterReviewed);

      const response = await fetch(`/api/qa-logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch logs');

      const data = await response.json();
      setLogs(data.logs);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [tenantSlug, filterFlagged, filterReviewed]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFlag = async (logId: string, flagged: boolean, reason?: string) => {
    try {
      const response = await fetch(`/api/qa-logs/${logId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug,
          flagged,
          flaggedReason: reason,
        }),
      });

      if (!response.ok) throw new Error('Failed to update log');

      // Refresh logs
      fetchLogs();
      setSelectedLog(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleReview = async (logId: string, reviewed: boolean, notes?: string) => {
    try {
      const response = await fetch(`/api/qa-logs/${logId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug,
          reviewed,
          reviewerNotes: notes,
        }),
      });

      if (!response.ok) throw new Error('Failed to update log');

      // Refresh logs
      fetchLogs();
      setSelectedLog(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Q&A Review</h1>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-6 shadow">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Tenant Slug</label>
            <input
              type="text"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              placeholder="Enter tenant slug..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Flagged</label>
            <select
              value={filterFlagged}
              onChange={(e) => setFilterFlagged(e.target.value as 'all' | 'true' | 'false')}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="all">All</option>
              <option value="true">Flagged</option>
              <option value="false">Not Flagged</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reviewed</label>
            <select
              value={filterReviewed}
              onChange={(e) => setFilterReviewed(e.target.value as 'all' | 'true' | 'false')}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="all">All</option>
              <option value="true">Reviewed</option>
              <option value="false">Not Reviewed</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchLogs}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* No tenant selected */}
      {!tenantSlug && (
        <div className="text-center text-gray-500 py-12">
          Enter a tenant slug to view Q&A logs
        </div>
      )}

      {/* Loading */}
      {isLoading && tenantSlug && (
        <div className="text-center py-12">Loading...</div>
      )}

      {/* Logs table */}
      {!isLoading && tenantSlug && logs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Question</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Confidence</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3">
                    <p className="text-sm truncate max-w-xs">{log.question}</p>
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge confidence={log.confidence} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {log.flagged && (
                        <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded">
                          Flagged
                        </span>
                      )}
                      {log.reviewed && (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                          Reviewed
                        </span>
                      )}
                      {!log.flagged && !log.reviewed && (
                        <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                          Pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(log.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination info */}
          {pagination && (
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 text-sm text-gray-500">
              Showing {logs.length} of {pagination.total} logs
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && tenantSlug && logs.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          No Q&A logs found for this tenant
        </div>
      )}

      {/* Detail modal */}
      {selectedLog && (
        <LogDetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
          onFlag={handleFlag}
          onReview={handleReview}
        />
      )}
    </div>
  );
}

// =============================================================================
// Components
// =============================================================================

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  const color =
    percentage >= 80
      ? 'bg-green-100 text-green-700'
      : percentage >= 60
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700';

  return (
    <span className={`px-2 py-1 text-xs rounded ${color}`}>
      {percentage}%
    </span>
  );
}

function LogDetailModal({
  log,
  onClose,
  onFlag,
  onReview,
}: {
  log: QALog;
  onClose: () => void;
  onFlag: (id: string, flagged: boolean, reason?: string) => void;
  onReview: (id: string, reviewed: boolean, notes?: string) => void;
}) {
  const [flagReason, setFlagReason] = useState(log.flaggedReason || '');
  const [reviewNotes, setReviewNotes] = useState(log.reviewerNotes || '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold">Q&A Log Detail</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Question */}
          <div>
            <h3 className="font-medium mb-2">Question</h3>
            <p className="text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-3 rounded">
              {log.question}
            </p>
          </div>

          {/* Answer */}
          <div>
            <h3 className="font-medium mb-2">Answer</h3>
            <p className="text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-3 rounded whitespace-pre-wrap">
              {log.answer}
            </p>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Confidence:</span>
              <span className="ml-2">{Math.round(log.confidence * 100)}%</span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>
              <span className="ml-2">{new Date(log.createdAt).toLocaleString()}</span>
            </div>
          </div>

          {/* Flag section */}
          <div className="border-t dark:border-gray-700 pt-4">
            <h3 className="font-medium mb-2">Flag</h3>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Reason for flagging..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 mb-2"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                onClick={() => onFlag(log.id, true, flagReason)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Flag
              </button>
              {log.flagged && (
                <button
                  onClick={() => onFlag(log.id, false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Unflag
                </button>
              )}
            </div>
          </div>

          {/* Review section */}
          <div className="border-t dark:border-gray-700 pt-4">
            <h3 className="font-medium mb-2">Review</h3>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Reviewer notes..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 mb-2"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                onClick={() => onReview(log.id, true, reviewNotes)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Mark Reviewed
              </button>
              {log.reviewed && (
                <button
                  onClick={() => onReview(log.id, false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Unmark
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

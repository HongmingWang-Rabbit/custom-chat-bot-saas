'use client';

/**
 * Q&A Review Page - View and manage Q&A interactions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';

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

interface Tenant {
  id: string;
  slug: string;
  name: string;
}

interface AnalysisResult {
  summary: {
    topTopics: string[];
    userConcerns: string[];
    attentionNeeded: {
      logId: string;
      reason: string;
      priority: 'high' | 'medium' | 'low';
    }[];
    overallInsights: string;
  };
  stats: {
    totalAnalyzed: number;
    avgConfidence: number;
    lowConfidenceCount: number;
    flaggedCount: number;
  };
  tokensUsed: number;
}

export default function ReviewPage() {
  const [logs, setLogs] = useState<QALog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<QALog | null>(null);

  // Tenant search
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filters
  const [filterFlagged, setFilterFlagged] = useState<'all' | 'true' | 'false'>('all');
  const [filterReviewed, setFilterReviewed] = useState<'all' | 'true' | 'false'>('all');
  const [confidenceMin, setConfidenceMin] = useState<string>('');
  const [confidenceMax, setConfidenceMax] = useState<string>('');

  // Analysis
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Fetch all tenants on mount
  useEffect(() => {
    async function fetchTenants() {
      try {
        const response = await fetch('/api/tenants');
        if (response.ok) {
          const data = await response.json();
          setTenants(data.tenants || []);
        } else {
          toast.error('Failed to load organizations');
        }
      } catch {
        toast.error('Failed to load organizations');
      }
    }
    fetchTenants();
  }, []);

  // Filter tenants based on search
  useEffect(() => {
    if (tenantSearch) {
      const filtered = tenants.filter(
        (t) =>
          t.slug.toLowerCase().includes(tenantSearch.toLowerCase()) ||
          t.name.toLowerCase().includes(tenantSearch.toLowerCase())
      );
      setFilteredTenants(filtered);
      setShowDropdown(filtered.length > 0);
    } else {
      setFilteredTenants([]);
      setShowDropdown(false);
    }
  }, [tenantSearch, tenants]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectTenant = (tenant: Tenant) => {
    setTenantSlug(tenant.slug);
    setTenantSearch(tenant.name);
    setShowDropdown(false);
  };

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
      if (confidenceMin) params.set('confidenceMin', confidenceMin);
      if (confidenceMax) params.set('confidenceMax', confidenceMax);

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
  }, [tenantSlug, filterFlagged, filterReviewed, confidenceMin, confidenceMax]);

  const handleAnalyze = async () => {
    if (logs.length === 0) {
      setAnalysisError('No logs to analyze. Please select an organization and apply filters.');
      setIsAnalysisOpen(true);
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    setIsAnalysisOpen(true);

    try {
      const response = await fetch('/api/qa-logs/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug,
          logs: logs.map((log) => ({
            id: log.id,
            question: log.question,
            answer: log.answer,
            confidence: log.confidence,
            flagged: log.flagged,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Analysis failed');
      }

      const data = await response.json();
      setAnalysis(data);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFlag = async (logId: string, flagged: boolean, reason?: string) => {
    try {
      const response = await fetch(`/api/qa-logs/${logId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug, flagged, flaggedReason: reason }),
      });
      if (!response.ok) throw new Error('Failed to update log');
      toast.success(flagged ? 'Log flagged' : 'Flag removed');
      fetchLogs();
      setSelectedLog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleReview = async (logId: string, reviewed: boolean, notes?: string) => {
    try {
      const response = await fetch(`/api/qa-logs/${logId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug, reviewed, reviewerNotes: notes }),
      });
      if (!response.ok) throw new Error('Failed to update log');
      toast.success(reviewed ? 'Marked as reviewed' : 'Review status cleared');
      fetchLogs();
      setSelectedLog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Q&A Logs</h1>
        <p className="mt-1 text-gray-500">Review questions and answers, flag issues, and track quality</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-2 relative" ref={dropdownRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
            <input
              type="text"
              value={tenantSearch}
              onChange={(e) => {
                setTenantSearch(e.target.value);
                setTenantSlug('');
              }}
              onFocus={() => {
                if (filteredTenants.length > 0) setShowDropdown(true);
              }}
              placeholder="Search organizations..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
            {/* Dropdown */}
            {showDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                {filteredTenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    onClick={() => selectTenant(tenant)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 border-b border-gray-100 last:border-0"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm font-medium">
                        {tenant.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{tenant.name}</p>
                      <p className="text-sm text-gray-500">{tenant.slug}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Flagged</label>
            <select
              value={filterFlagged}
              onChange={(e) => setFilterFlagged(e.target.value as 'all' | 'true' | 'false')}
              data-testid="filter-flagged"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
            >
              <option value="all">All</option>
              <option value="true">Flagged</option>
              <option value="false">Not Flagged</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reviewed</label>
            <select
              value={filterReviewed}
              onChange={(e) => setFilterReviewed(e.target.value as 'all' | 'true' | 'false')}
              data-testid="filter-reviewed"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
            >
              <option value="all">All</option>
              <option value="true">Reviewed</option>
              <option value="false">Not Reviewed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confidence %</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Min"
                value={confidenceMin}
                onChange={(e) => setConfidenceMin(e.target.value)}
                className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              />
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Max"
                value={confidenceMax}
                onChange={(e) => setConfidenceMax(e.target.value)}
                className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchLogs}
              className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
            >
              Search
            </button>
          </div>
        </div>

        {/* AI Analyze Button */}
        <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleAnalyze}
            disabled={!tenantSlug || logs.length === 0 || isAnalyzing}
            className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Analyzing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Analyze
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 mb-6">
          {error}
        </div>
      )}

      {/* No tenant selected */}
      {!tenantSlug && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select an organization</h3>
          <p className="text-gray-500">Enter an organization slug to view Q&A logs</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && tenantSlug && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading logs...
          </div>
        </div>
      )}

      {/* Logs List */}
      {!isLoading && tenantSlug && logs.length > 0 && (
        <div className="space-y-4">
          {logs.map((log) => (
            <LogCard
              key={log.id}
              log={log}
              onClick={() => setSelectedLog(log)}
            />
          ))}

          {/* Pagination info */}
          {pagination && (
            <div className="text-center text-sm text-gray-500 py-4">
              Showing {logs.length} of {pagination.total} logs
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && tenantSlug && logs.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Q&A logs found</h3>
          <p className="text-gray-500">No questions have been asked for this organization yet</p>
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

      {/* Analysis modal */}
      {isAnalysisOpen && (
        <AnalysisModal
          isLoading={isAnalyzing}
          error={analysisError}
          analysis={analysis}
          onClose={() => {
            setIsAnalysisOpen(false);
            setAnalysis(null);
            setAnalysisError(null);
          }}
          onLogClick={(logId) => {
            const log = logs.find((l) => l.id === logId);
            if (log) {
              setSelectedLog(log);
              setIsAnalysisOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}

function LogCard({ log, onClick }: { log: QALog; onClick: () => void }) {
  const confidencePercent = Math.round(log.confidence * 100);
  const confidenceColor = confidencePercent >= 80 ? 'text-green-600' : confidencePercent >= 60 ? 'text-yellow-600' : 'text-red-600';

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-6 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Question */}
          <p className="font-medium text-gray-900 mb-2">{log.question}</p>
          {/* Answer preview */}
          <p className="text-sm text-gray-500 line-clamp-2">{log.answer}</p>
        </div>

        {/* Right side */}
        <div className="flex flex-col items-end gap-2">
          {/* Confidence */}
          <span className={`text-2xl font-semibold ${confidenceColor}`}>
            {confidencePercent}%
          </span>

          {/* Status badges */}
          <div className="flex gap-1">
            {log.flagged && (
              <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                Flagged
              </span>
            )}
            {log.reviewed && (
              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                Reviewed
              </span>
            )}
            {!log.flagged && !log.reviewed && (
              <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                Pending
              </span>
            )}
          </div>

          {/* Date */}
          <span className="text-xs text-gray-400">
            {new Date(log.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
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
  const confidencePercent = Math.round(log.confidence * 100);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Q&A Detail</h2>
            <span className={`px-2 py-1 text-sm font-medium rounded-full ${
              confidencePercent >= 80 ? 'bg-green-100 text-green-700' :
              confidencePercent >= 60 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {confidencePercent}% confidence
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Question */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-2">Question</label>
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-gray-900">{log.question}</p>
            </div>
          </div>

          {/* Answer */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-2">Answer</label>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-gray-700 whitespace-pre-wrap">{log.answer}</p>
            </div>
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <span>Asked: {new Date(log.createdAt).toLocaleString()}</span>
            {log.flaggedAt && <span>Flagged: {new Date(log.flaggedAt).toLocaleString()}</span>}
            {log.reviewedAt && <span>Reviewed: {new Date(log.reviewedAt).toLocaleString()}</span>}
          </div>

          {/* Actions */}
          <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
            {/* Flag Section */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">Flag Issue</label>
              <textarea
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                placeholder="Reason for flagging..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onFlag(log.id, true, flagReason)}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition text-sm"
                >
                  {log.flagged ? 'Update Flag' : 'Flag'}
                </button>
                {log.flagged && (
                  <button
                    onClick={() => onFlag(log.id, false)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition text-sm"
                  >
                    Unflag
                  </button>
                )}
              </div>
            </div>

            {/* Review Section */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">Review Notes</label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add review notes..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onReview(log.id, true, reviewNotes)}
                  className="flex-1 px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition text-sm"
                >
                  {log.reviewed ? 'Update Review' : 'Mark Reviewed'}
                </button>
                {log.reviewed && (
                  <button
                    onClick={() => onReview(log.id, false)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition text-sm"
                  >
                    Unmark
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalysisModal({
  isLoading,
  error,
  analysis,
  onClose,
  onLogClick,
}: {
  isLoading: boolean;
  error: string | null;
  analysis: AnalysisResult | null;
  onClose: () => void;
  onLogClick: (logId: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">AI Analysis</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Loading State */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <svg className="w-8 h-8 animate-spin text-purple-600 mb-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-gray-500">Analyzing Q&A logs...</p>
              <p className="text-sm text-gray-400 mt-1">This may take a few seconds</p>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            </div>
          )}

          {/* Analysis Results */}
          {analysis && !isLoading && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-semibold text-gray-900">{analysis.stats.totalAnalyzed}</p>
                  <p className="text-sm text-gray-500">Logs Analyzed</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-semibold text-gray-900">{Math.round(analysis.stats.avgConfidence * 100)}%</p>
                  <p className="text-sm text-gray-500">Avg Confidence</p>
                </div>
                <div className="bg-yellow-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-semibold text-yellow-700">{analysis.stats.lowConfidenceCount}</p>
                  <p className="text-sm text-yellow-600">Low Confidence</p>
                </div>
                <div className="bg-red-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-semibold text-red-700">{analysis.stats.flaggedCount}</p>
                  <p className="text-sm text-red-600">Flagged</p>
                </div>
              </div>

              {/* Top Topics */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">Most Common Topics</h3>
                <div className="flex flex-wrap gap-2">
                  {analysis.summary.topTopics.map((topic, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>

              {/* User Concerns */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">What Users Care About</h3>
                <ul className="space-y-2">
                  {analysis.summary.userConcerns.map((concern, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-600">
                      <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      {concern}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Attention Needed */}
              {analysis.summary.attentionNeeded.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Logs Needing Attention</h3>
                  <div className="space-y-2">
                    {analysis.summary.attentionNeeded.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => onLogClick(item.logId)}
                        className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition flex items-start gap-3"
                      >
                        <span
                          className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            item.priority === 'high'
                              ? 'bg-red-100 text-red-700'
                              : item.priority === 'medium'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {item.priority === 'high' ? '!' : item.priority === 'medium' ? '?' : '-'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">{item.reason}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Click to view log</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Overall Insights */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">Summary</h3>
                <div className="bg-purple-50 rounded-xl p-4">
                  <p className="text-gray-700">{analysis.summary.overallInsights}</p>
                </div>
              </div>

              {/* Tokens Used */}
              <p className="text-xs text-gray-400 text-right">
                Analysis used {analysis.tokensUsed.toLocaleString()} tokens
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

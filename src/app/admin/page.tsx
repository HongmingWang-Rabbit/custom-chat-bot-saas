'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

/**
 * Admin dashboard home page with real data from APIs.
 */

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
}

interface Document {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface QALog {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  createdAt: string;
}

interface DashboardStats {
  organizationsCount: number;
  documentsCount: number;
  questionsCount: number;
  avgConfidence: number;
}

interface RecentActivity {
  type: 'question' | 'document' | 'tenant';
  title: string;
  tenant?: string;
  time: string;
  confidence?: number;
}

export default function AdminPage() {
  const [stats, setStats] = useState<DashboardStats>({
    organizationsCount: 0,
    documentsCount: 0,
    questionsCount: 0,
    avgConfidence: 0,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch tenants
      const tenantsRes = await fetch('/api/tenants');
      if (!tenantsRes.ok) throw new Error('Failed to fetch tenants');
      const tenantsData = await tenantsRes.json();
      const tenants: Tenant[] = tenantsData.tenants || [];

      // Aggregate data from all tenants
      let totalDocuments = 0;
      let totalQuestions = 0;
      let totalConfidence = 0;
      let confidenceCount = 0;
      const allActivity: RecentActivity[] = [];

      // Add tenant creation activities
      for (const tenant of tenants) {
        allActivity.push({
          type: 'tenant',
          title: `Organization created: ${tenant.name}`,
          time: tenant.createdAt,
        });
      }

      // Fetch documents and Q&A logs for each tenant
      for (const tenant of tenants) {
        try {
          // Fetch documents
          const docsRes = await fetch(`/api/documents?tenantSlug=${tenant.slug}`);
          if (docsRes.ok) {
            const docsData = await docsRes.json();
            const docs: Document[] = docsData.documents || [];
            totalDocuments += docs.length;

            // Add document activities
            for (const doc of docs.slice(0, 5)) {
              allActivity.push({
                type: 'document',
                title: `${doc.title} uploaded`,
                tenant: tenant.name,
                time: doc.createdAt,
              });
            }
          }

          // Fetch Q&A logs
          const logsRes = await fetch(`/api/qa-logs?tenantSlug=${tenant.slug}&limit=100`);
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            const logs: QALog[] = logsData.logs || [];
            totalQuestions += logsData.pagination?.total || logs.length;

            // Calculate average confidence
            for (const log of logs) {
              if (log.confidence !== null && log.confidence !== undefined) {
                totalConfidence += log.confidence;
                confidenceCount++;
              }
            }

            // Add Q&A activities
            for (const log of logs.slice(0, 5)) {
              allActivity.push({
                type: 'question',
                title: log.question,
                tenant: tenant.name,
                time: log.createdAt,
                confidence: log.confidence ? Math.round(log.confidence * 100) : undefined,
              });
            }
          }
        } catch (err) {
          console.error(`Failed to fetch data for tenant ${tenant.slug}:`, err);
        }
      }

      // Sort activity by time (most recent first)
      allActivity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      setStats({
        organizationsCount: tenants.length,
        documentsCount: totalDocuments,
        questionsCount: totalQuestions,
        avgConfidence: confidenceCount > 0 ? Math.round((totalConfidence / confidenceCount) * 100) : 0,
      });

      setRecentActivity(allActivity.slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-gray-500">Overview of your Q&A platform</p>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 mb-6">
          {error}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard
          label="Organizations"
          value={isLoading ? '...' : stats.organizationsCount.toString()}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />
        <StatCard
          label="Total Documents"
          value={isLoading ? '...' : stats.documentsCount.toString()}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          label="Questions Asked"
          value={isLoading ? '...' : stats.questionsCount.toString()}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Avg. Confidence"
          value={isLoading ? '...' : `${stats.avgConfidence}%`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionCard
            title="View Q&A Logs"
            description="Review recent questions and answers"
            href="/admin/review"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            }
          />
          <ActionCard
            title="Upload Documents"
            description="Add new documents to knowledge base"
            href="/admin/documents"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            }
          />
          <ActionCard
            title="New Organization"
            description="Create a new tenant organization"
            href="/admin/tenants"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center gap-2 text-gray-500">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading activity...
              </div>
            </div>
          ) : recentActivity.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-500">No activity yet</p>
              <p className="text-sm text-gray-400 mt-1">Create an organization to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentActivity.map((activity, index) => (
                <ActivityItem
                  key={index}
                  type={activity.type}
                  title={activity.title}
                  tenant={activity.tenant}
                  time={formatRelativeTime(activity.time)}
                  confidence={activity.confidence}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
          {icon}
        </div>
      </div>
      <p className="text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function ActionCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
        {icon}
      </div>
      <div>
        <h3 className="font-medium text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </Link>
  );
}

function ActivityItem({
  type,
  title,
  tenant,
  time,
  confidence,
}: {
  type: 'question' | 'document' | 'tenant';
  title: string;
  tenant?: string;
  time: string;
  confidence?: number;
}) {
  const icons = {
    question: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    document: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    tenant: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  };

  const bgColors = {
    question: 'bg-purple-50 text-purple-600',
    document: 'bg-blue-50 text-blue-600',
    tenant: 'bg-green-50 text-green-600',
  };

  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div className={`p-2 rounded-lg ${bgColors[type]}`}>
        {icons[type]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
        <p className="text-xs text-gray-500">
          {tenant && <span>{tenant} · </span>}
          {time}
        </p>
      </div>
      {confidence !== undefined && (
        <div className="text-right">
          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            confidence >= 80 ? 'bg-green-100 text-green-700' :
            confidence >= 60 ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {confidence}% confident
          </span>
        </div>
      )}
    </div>
  );
}

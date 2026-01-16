'use client';

/**
 * Tenant Settings Page
 *
 * Configure tenant branding, RAG settings, and credentials.
 */

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';

// =============================================================================
// Types
// =============================================================================

interface Branding {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: string;
  logoUrl: string | null;
}

interface RAGConfig {
  topK: number;
  confidenceThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
}

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  databaseHost: string | null;
  llmProvider: string | null;
  branding: Branding | null;
  ragConfig: RAGConfig | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Page Component
// =============================================================================

export default function TenantSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'documents' | 'branding' | 'rag'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [llmProvider, setLlmProvider] = useState('openai');
  const [branding, setBranding] = useState<Branding>({
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    backgroundColor: '#FFFFFF',
    textColor: '#1F2937',
    accentColor: '#10B981',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
    logoUrl: null,
  });
  const [ragConfig, setRagConfig] = useState<RAGConfig>({
    topK: 5,
    confidenceThreshold: 0.25,
    chunkSize: 500,
    chunkOverlap: 50,
  });

  useEffect(() => {
    async function fetchTenant() {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/tenants/${slug}`);
        if (!response.ok) throw new Error('Tenant not found');
        const data = await response.json();
        setTenant(data.tenant);
        setName(data.tenant.name);
        setLlmProvider(data.tenant.llmProvider || 'openai');
        if (data.tenant.branding) setBranding(data.tenant.branding);
        if (data.tenant.ragConfig) setRagConfig(data.tenant.ragConfig);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }
    fetchTenant();
  }, [slug]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);

    try {
      const response = await fetch(`/api/tenants/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          llmProvider,
          branding,
          ragConfig,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save');
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this tenant? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/tenants/${slug}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete');
      router.push('/admin/tenants');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-center py-12">Loading...</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8">
        <div className="text-center py-12 text-red-500">Tenant not found</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <p className="text-gray-500 text-sm">/{tenant.slug}</p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/demo/${tenant.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            View Demo
          </a>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
          >
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-100 text-green-700 p-4 rounded-lg mb-6">
          Settings saved successfully!
        </div>
      )}

      {/* Tabs */}
      <div className="border-b dark:border-gray-700 mb-6">
        <div className="flex gap-4">
          <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')}>
            General
          </TabButton>
          <TabButton active={activeTab === 'documents'} onClick={() => setActiveTab('documents')}>
            Documents
          </TabButton>
          <TabButton active={activeTab === 'branding'} onClick={() => setActiveTab('branding')}>
            Branding
          </TabButton>
          <TabButton active={activeTab === 'rag'} onClick={() => setActiveTab('rag')}>
            RAG Settings
          </TabButton>
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        {activeTab === 'general' && (
          <GeneralSettings
            name={name}
            setName={setName}
            llmProvider={llmProvider}
            setLlmProvider={setLlmProvider}
            tenant={tenant}
          />
        )}

        {activeTab === 'documents' && (
          <DocumentsSettings tenantSlug={tenant.slug} />
        )}

        {activeTab === 'branding' && (
          <BrandingSettings branding={branding} setBranding={setBranding} />
        )}

        {activeTab === 'rag' && (
          <RAGSettings ragConfig={ragConfig} setRagConfig={setRagConfig} />
        )}

        {/* Save button - only show for settings tabs, not documents */}
        {activeTab !== 'documents' && (
          <div className="mt-6 pt-6 border-t dark:border-gray-700 flex justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Components
// =============================================================================

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-3 px-1 border-b-2 transition-colors ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function GeneralSettings({
  name,
  setName,
  llmProvider,
  setLlmProvider,
  tenant,
}: {
  name: string;
  setName: (v: string) => void;
  llmProvider: string;
  setLlmProvider: (v: string) => void;
  tenant: Tenant;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Slug</label>
        <input
          type="text"
          value={tenant.slug}
          disabled
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-600 dark:border-gray-600"
        />
        <p className="text-xs text-gray-500 mt-1">Slug cannot be changed</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">LLM Provider</label>
        <select
          value={llmProvider}
          onChange={(e) => setLlmProvider(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="azure">Azure OpenAI</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Database Host</label>
        <input
          type="text"
          value={tenant.databaseHost || '-'}
          disabled
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-600 dark:border-gray-600"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <input
          type="text"
          value={tenant.status}
          disabled
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-600 dark:border-gray-600"
        />
      </div>
    </div>
  );
}

function BrandingSettings({
  branding,
  setBranding,
}: {
  branding: Branding;
  setBranding: (b: Branding) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Color pickers */}
      <div className="grid grid-cols-2 gap-4">
        <ColorPicker
          label="Primary Color"
          value={branding.primaryColor}
          onChange={(v) => setBranding({ ...branding, primaryColor: v })}
        />
        <ColorPicker
          label="Secondary Color"
          value={branding.secondaryColor}
          onChange={(v) => setBranding({ ...branding, secondaryColor: v })}
        />
        <ColorPicker
          label="Background Color"
          value={branding.backgroundColor}
          onChange={(v) => setBranding({ ...branding, backgroundColor: v })}
        />
        <ColorPicker
          label="Text Color"
          value={branding.textColor}
          onChange={(v) => setBranding({ ...branding, textColor: v })}
        />
        <ColorPicker
          label="Accent Color"
          value={branding.accentColor}
          onChange={(v) => setBranding({ ...branding, accentColor: v })}
        />
      </div>

      {/* Font family */}
      <div>
        <label className="block text-sm font-medium mb-1">Font Family</label>
        <input
          type="text"
          value={branding.fontFamily}
          onChange={(e) => setBranding({ ...branding, fontFamily: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
        />
      </div>

      {/* Border radius */}
      <div>
        <label className="block text-sm font-medium mb-1">Border Radius</label>
        <input
          type="text"
          value={branding.borderRadius}
          onChange={(e) => setBranding({ ...branding, borderRadius: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
          placeholder="8px"
        />
      </div>

      {/* Logo URL */}
      <div>
        <label className="block text-sm font-medium mb-1">Logo URL</label>
        <input
          type="text"
          value={branding.logoUrl || ''}
          onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value || null })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
          placeholder="https://..."
        />
      </div>

      {/* Preview */}
      <div>
        <label className="block text-sm font-medium mb-2">Preview</label>
        <div
          className="p-4 rounded-lg border"
          style={{
            backgroundColor: branding.backgroundColor,
            color: branding.textColor,
            fontFamily: branding.fontFamily,
            borderRadius: branding.borderRadius,
          }}
        >
          <div
            className="p-3 rounded mb-2"
            style={{ backgroundColor: branding.primaryColor, color: '#fff' }}
          >
            Primary Button
          </div>
          <div
            className="p-3 rounded mb-2"
            style={{ backgroundColor: branding.secondaryColor, color: '#fff' }}
          >
            Secondary Button
          </div>
          <p>Sample text content</p>
          <p style={{ color: branding.accentColor }}>Accent text</p>
        </div>
      </div>
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded border cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
        />
      </div>
    </div>
  );
}

function RAGSettings({
  ragConfig,
  setRagConfig,
}: {
  ragConfig: RAGConfig;
  setRagConfig: (r: RAGConfig) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Top K (chunks to retrieve)</label>
        <input
          type="number"
          value={ragConfig.topK}
          onChange={(e) => setRagConfig({ ...ragConfig, topK: parseInt(e.target.value) || 5 })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
          min={1}
          max={50}
        />
        <p className="text-xs text-gray-500 mt-1">Number of document chunks to retrieve for context (1-50)</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Confidence Threshold</label>
        <input
          type="number"
          value={ragConfig.confidenceThreshold}
          onChange={(e) => setRagConfig({ ...ragConfig, confidenceThreshold: parseFloat(e.target.value) || 0.25 })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
          min={0}
          max={1}
          step={0.1}
        />
        <p className="text-xs text-gray-500 mt-1">Minimum similarity score (0.0 - 1.0)</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Chunk Size (characters)</label>
        <input
          type="number"
          value={ragConfig.chunkSize}
          onChange={(e) => setRagConfig({ ...ragConfig, chunkSize: parseInt(e.target.value) || 500 })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
          min={100}
          max={2000}
        />
        <p className="text-xs text-gray-500 mt-1">Maximum characters per document chunk</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Chunk Overlap (characters)</label>
        <input
          type="number"
          value={ragConfig.chunkOverlap}
          onChange={(e) => setRagConfig({ ...ragConfig, chunkOverlap: parseInt(e.target.value) || 50 })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-white dark:bg-gray-700 dark:border-gray-600"
          min={0}
          max={500}
        />
        <p className="text-xs text-gray-500 mt-1">Overlap between consecutive chunks</p>
      </div>
    </div>
  );
}

// =============================================================================
// Documents Settings Component
// =============================================================================

interface Document {
  id: string;
  title: string;
  fileName: string | null;
  fileSize: number | null;
  docType: string | null;
  status: string;
  chunkCount: number;
  hasOriginalFile?: boolean;
  createdAt: string;
}

function DocumentsSettings({ tenantSlug }: { tenantSlug: string }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const fetchDocuments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents?tenantSlug=${tenantSlug}`);
      if (!response.ok) throw new Error('Failed to fetch documents');
      const data = await response.json();
      setDocuments(data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenantSlug', tenantSlug);

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      setUploadProgress('Processing complete!');
      setTimeout(() => setUploadProgress(null), 2000);
      fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress(null);
    } finally {
      setIsUploading(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      const response = await fetch(`/api/documents/${doc.id}/download?tenantSlug=${tenantSlug}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Download failed');
      }
      const data = await response.json();
      window.open(data.download.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Are you sure you want to delete "${doc.title}"? This will remove the document and all its chunks.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/documents/${doc.id}?tenantSlug=${tenantSlug}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }

      fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusColors: Record<string, string> = {
    ready: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">Documents</h3>
          <p className="text-sm text-gray-500">Manage documents for this organization&apos;s Q&A bot</p>
        </div>
        <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition">
          <input
            type="file"
            className="hidden"
            accept=".pdf,.txt,.md,.docx"
            onChange={handleUpload}
            disabled={isUploading}
          />
          {isUploading ? 'Uploading...' : 'Upload Document'}
        </label>
      </div>

      {/* Upload Progress */}
      {uploadProgress && (
        <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 p-3 rounded-lg text-sm flex items-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {uploadProgress}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-8 text-gray-500">Loading documents...</div>
      )}

      {/* Empty State */}
      {!isLoading && documents.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500 dark:text-gray-400 mb-2">No documents yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">Upload PDF, TXT, MD, or DOCX files to get started</p>
        </div>
      )}

      {/* Documents List */}
      {!isLoading && documents.length > 0 && (
        <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Document</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Chunks</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{doc.title}</div>
                      {doc.fileName && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{doc.fileName}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {doc.docType || 'disclosure'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatFileSize(doc.fileSize)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {doc.chunkCount}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusColors[doc.status] || 'bg-gray-100 text-gray-700'}`}>
                      {doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {doc.hasOriginalFile && (
                        <button
                          onClick={() => handleDownload(doc)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition"
                          title="Download"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(doc)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Supported formats: PDF, TXT, MD, DOCX (max 10MB)
      </div>
    </div>
  );
}

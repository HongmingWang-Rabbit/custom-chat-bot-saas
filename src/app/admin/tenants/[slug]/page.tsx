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
  customCss: string | null;
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
  const [activeTab, setActiveTab] = useState<'general' | 'branding' | 'rag'>('general');
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
    customCss: null,
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

        {activeTab === 'branding' && (
          <BrandingSettings branding={branding} setBranding={setBranding} />
        )}

        {activeTab === 'rag' && (
          <RAGSettings ragConfig={ragConfig} setRagConfig={setRagConfig} />
        )}

        {/* Save button */}
        <div className="mt-6 pt-6 border-t dark:border-gray-700 flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
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
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Slug</label>
        <input
          type="text"
          value={tenant.slug}
          disabled
          className="w-full px-3 py-2 border rounded-lg bg-gray-100 dark:bg-gray-600 dark:border-gray-600"
        />
        <p className="text-xs text-gray-500 mt-1">Slug cannot be changed</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">LLM Provider</label>
        <select
          value={llmProvider}
          onChange={(e) => setLlmProvider(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-lg bg-gray-100 dark:bg-gray-600 dark:border-gray-600"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <input
          type="text"
          value={tenant.status}
          disabled
          className="w-full px-3 py-2 border rounded-lg bg-gray-100 dark:bg-gray-600 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
        />
      </div>

      {/* Border radius */}
      <div>
        <label className="block text-sm font-medium mb-1">Border Radius</label>
        <input
          type="text"
          value={branding.borderRadius}
          onChange={(e) => setBranding({ ...branding, borderRadius: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          placeholder="https://..."
        />
      </div>

      {/* Custom CSS */}
      <div>
        <label className="block text-sm font-medium mb-1">Custom CSS</label>
        <textarea
          value={branding.customCss || ''}
          onChange={(e) => setBranding({ ...branding, customCss: e.target.value || null })}
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 font-mono text-sm"
          rows={6}
          placeholder="/* Custom CSS styles */"
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
          className="flex-1 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          min={1}
          max={20}
        />
        <p className="text-xs text-gray-500 mt-1">Number of document chunks to retrieve for context</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Confidence Threshold</label>
        <input
          type="number"
          value={ragConfig.confidenceThreshold}
          onChange={(e) => setRagConfig({ ...ragConfig, confidenceThreshold: parseFloat(e.target.value) || 0.25 })}
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
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
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          min={0}
          max={500}
        />
        <p className="text-xs text-gray-500 mt-1">Overlap between consecutive chunks</p>
      </div>
    </div>
  );
}

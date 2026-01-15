import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenantService } from '@/lib/services/tenant-service';
import { DemoPageClient } from './DemoPageClient';

// =============================================================================
// Types
// =============================================================================

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

// =============================================================================
// Metadata
// =============================================================================

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  const tenantService = getTenantService();
  const tenant = await tenantService.getTenant(tenantSlug);

  if (!tenant) {
    return {
      title: 'Not Found',
    };
  }

  return {
    title: `${tenant.name} - Investor Q&A`,
    description: `Ask questions about ${tenant.name} investor disclosures and documents`,
  };
}

// =============================================================================
// Page Component
// =============================================================================

export default async function DemoPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenantService = getTenantService();
  const tenant = await tenantService.getTenant(tenantSlug);

  if (!tenant) {
    notFound();
  }

  // Extract public branding info (no secrets)
  const branding = tenant.branding ?? {
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    backgroundColor: '#FFFFFF',
    textColor: '#1F2937',
    accentColor: '#10B981',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
    logoUrl: null,
    customCss: null,
  };

  return (
    <DemoPageClient
      tenantSlug={tenantSlug}
      tenantName={tenant.name}
      branding={branding}
    />
  );
}

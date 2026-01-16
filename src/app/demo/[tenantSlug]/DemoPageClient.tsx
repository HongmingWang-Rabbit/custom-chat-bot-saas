'use client';

/**
 * Demo page client component.
 *
 * Renders the Q&A chat interface with tenant-specific branding.
 */

import Link from 'next/link';
import { useEffect } from 'react';
import { ChatContainer } from '@/components/features/qa';
import { useChat } from '@/hooks/useChat';

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

interface DemoPageClientProps {
  tenantSlug: string;
  tenantName: string;
  branding: Branding;
}

// =============================================================================
// Component
// =============================================================================

export function DemoPageClient({
  tenantSlug,
  tenantName,
  branding,
}: DemoPageClientProps) {
  const { messages, isLoading, sendMessage } = useChat({
    tenantSlug,
    onError: (error) => {
      console.error('[DemoPage] Chat error:', error);
    },
  });

  // Apply tenant branding via CSS custom properties
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', branding.primaryColor);
    root.style.setProperty('--color-secondary', branding.secondaryColor);
    root.style.setProperty('--color-background', branding.backgroundColor);
    root.style.setProperty('--color-text', branding.textColor);
    root.style.setProperty('--color-accent', branding.accentColor);
    root.style.setProperty('--font-family', branding.fontFamily);
    root.style.setProperty('--border-radius', branding.borderRadius);

    // Cleanup on unmount
    return () => {
      root.style.removeProperty('--color-primary');
      root.style.removeProperty('--color-secondary');
      root.style.removeProperty('--color-background');
      root.style.removeProperty('--color-text');
      root.style.removeProperty('--color-accent');
      root.style.removeProperty('--font-family');
      root.style.removeProperty('--border-radius');
    };
  }, [branding]);

  // Inject custom CSS if provided
  useEffect(() => {
    if (!branding.customCss) return;

    const style = document.createElement('style');
    style.id = 'tenant-custom-css';
    style.textContent = branding.customCss;
    document.head.appendChild(style);

    return () => {
      const existing = document.getElementById('tenant-custom-css');
      if (existing) {
        existing.remove();
      }
    };
  }, [branding.customCss]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and tenant name */}
            <div className="flex items-center gap-3">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={`${tenantName} logo`}
                  className="h-8 w-auto"
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {tenantName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div>
                <h1 className="font-semibold text-gray-900">{tenantName}</h1>
                <p className="text-xs text-gray-500">Investor Q&A</p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-sm text-gray-600 hover:text-gray-900 transition"
              >
                Home
              </Link>
              <Link
                href="/admin"
                className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition"
              >
                Admin Panel
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main chat area */}
      <main className="h-[calc(100vh-65px)]">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 lg:px-8 py-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm h-full overflow-hidden">
            <ChatContainer
              messages={messages}
              isLoading={isLoading}
              onSendMessage={sendMessage}
              tenantName={tenantName}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

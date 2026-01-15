'use client';

/**
 * Demo page client component.
 *
 * Renders the Q&A chat interface with tenant-specific branding.
 */

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
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      {/* Header with logo */}
      <header className="border-b border-[var(--color-border)] bg-white dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={`${tenantName} logo`}
              className="h-8 w-auto"
            />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-[var(--color-primary)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {tenantName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <span className="font-semibold">{tenantName}</span>
        </div>
      </header>

      {/* Main chat area */}
      <main className="h-[calc(100vh-57px)]">
        <div className="max-w-5xl mx-auto h-full">
          <ChatContainer
            messages={messages}
            isLoading={isLoading}
            onSendMessage={sendMessage}
            tenantName={tenantName}
          />
        </div>
      </main>
    </div>
  );
}

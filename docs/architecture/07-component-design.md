# Component Design

## Overview

The UI is built with React Server Components (RSC) where possible, with Client Components for interactivity. Styling uses Tailwind CSS with shadcn/ui components.

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Page Components (RSC)                             │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │   /demo/[slug]      │  │   /admin/review     │  │ /admin/companies    │ │
│  │   page.tsx          │  │   page.tsx          │  │   /[slug]/page.tsx  │ │
│  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘ │
│             │                        │                        │             │
└─────────────┼────────────────────────┼────────────────────────┼─────────────┘
              │                        │                        │
              ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Feature Components (Mixed)                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Q&A Components                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ QuestionForm │  │AnswerDisplay │  │CitationsList │              │   │
│  │  │   (Client)   │  │   (Client)   │  │   (Client)   │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Admin Components                                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ QALogsTable  │  │  FlagButton  │  │ CompanyForm  │              │   │
│  │  │   (Client)   │  │   (Client)   │  │   (Client)   │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UI Components (shadcn/ui)                        │
│                                                                             │
│  Button  Input  Card  Table  Badge  Dialog  Textarea  ColorPicker          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Custom Hooks

### `useStreamingResponse`

Handles SSE streaming for Q&A responses.

```typescript
// src/hooks/use-streaming-response.ts
'use client';

import { useState, useCallback } from 'react';
import { Citation } from '@/types/database';
import { QAResponse } from '@/types/api';

interface StreamingState {
  isLoading: boolean;
  isStreaming: boolean;
  answer: string;
  citations: Citation[];
  confidence: number | null;
  error: string | null;
}

export function useStreamingResponse() {
  const [state, setState] = useState<StreamingState>({
    isLoading: false,
    isStreaming: false,
    answer: '',
    citations: [],
    confidence: null,
    error: null,
  });

  const askQuestion = useCallback(async (
    companySlug: string,
    question: string
  ) => {
    // Reset state
    setState({
      isLoading: true,
      isStreaming: false,
      answer: '',
      citations: [],
      confidence: null,
      error: null,
    });

    try {
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companySlug, question, stream: true }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response body');

      setState(prev => ({ ...prev, isLoading: false, isStreaming: true }));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (data.type) {
                case 'token':
                  setState(prev => ({
                    ...prev,
                    answer: prev.answer + data.data,
                  }));
                  break;

                case 'citation':
                  setState(prev => ({
                    ...prev,
                    citations: [...prev.citations, data.data],
                  }));
                  break;

                case 'done':
                  setState(prev => ({
                    ...prev,
                    isStreaming: false,
                    confidence: data.data.confidence,
                  }));
                  break;

                case 'error':
                  setState(prev => ({
                    ...prev,
                    isStreaming: false,
                    error: data.data,
                  }));
                  break;
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isStreaming: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      isStreaming: false,
      answer: '',
      citations: [],
      confidence: null,
      error: null,
    });
  }, []);

  return { ...state, askQuestion, reset };
}
```

### `useChat`

Main hook for the chat interface with SSE streaming and loading status.

```typescript
// src/hooks/useChat.ts
'use client';

import type { Message, CitationData, LoadingStatus } from '@/components/features/qa';

interface UseChatOptions {
  tenantSlug: string;
  onError?: (error: string) => void;
}

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  loadingStatus: LoadingStatus;
  error: string | null;
  sendMessage: (question: string) => Promise<void>;
  clearMessages: () => void;
}

export function useChat(options: UseChatOptions): UseChatReturn;
export type { LoadingStatus };
```

Features:
- **SSE streaming**: Handles `content`, `citations`, `status`, `confidence`, and `error` events
- **Loading status**: Exposes current pipeline stage (`searching`, `generating`)
- **Message history**: Maintains array of user/assistant messages
- **Citation accumulation**: Collects citations as they stream in
- **AbortController**: Cancels in-flight requests on unmount to prevent memory leaks
- **Session management**: Auto-generates session IDs, regenerates on `clearMessages()`
- **Error handling**: Ignores AbortError (expected on unmount), propagates application errors

---

### `useCompanyTheme`

Applies company branding via CSS custom properties.

```typescript
// src/hooks/use-company-theme.ts
'use client';

import { useEffect } from 'react';
import { CompanyBranding } from '@/types/database';

export function useCompanyTheme(branding: CompanyBranding | null) {
  useEffect(() => {
    if (!branding) return;

    const root = document.documentElement;

    // Apply CSS custom properties
    root.style.setProperty('--color-primary', branding.primaryColor);
    root.style.setProperty('--color-secondary', branding.secondaryColor);
    root.style.setProperty('--color-background', branding.backgroundColor);
    root.style.setProperty('--color-text', branding.textColor);
    root.style.setProperty('--color-accent', branding.accentColor);
    root.style.setProperty('--font-family', branding.fontFamily);
    root.style.setProperty('--border-radius', branding.borderRadius);

    // Apply custom CSS if provided
    if (branding.customCss) {
      const styleId = 'company-custom-css';
      let styleEl = document.getElementById(styleId) as HTMLStyleElement;

      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }

      styleEl.textContent = branding.customCss;
    }

    // Cleanup on unmount
    return () => {
      const styleEl = document.getElementById('company-custom-css');
      if (styleEl) styleEl.remove();
    };
  }, [branding]);
}
```

---

## Feature Components

### QuestionForm

```typescript
// src/components/features/qa/question-form.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface QuestionFormProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
  isDisabled?: boolean;
}

export function QuestionForm({
  onSubmit,
  isLoading,
  isDisabled
}: QuestionFormProps) {
  const [question, setQuestion] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim() && !isLoading) {
      onSubmit(question.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Textarea
        placeholder="Ask a question about the company..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        disabled={isDisabled || isLoading}
        className="min-h-[100px] resize-none"
        maxLength={1000}
      />

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {question.length}/1000 characters
        </span>

        <Button
          type="submit"
          disabled={!question.trim() || isLoading || isDisabled}
        >
          {isLoading ? 'Thinking...' : 'Ask Question'}
        </Button>
      </div>
    </form>
  );
}
```

### AnswerDisplay

```typescript
// src/components/features/qa/answer-display.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface AnswerDisplayProps {
  answer: string;
  confidence: number | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
}

export function AnswerDisplay({
  answer,
  confidence,
  isLoading,
  isStreaming,
  error,
}: AnswerDisplayProps) {
  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading && !isStreaming) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </CardContent>
      </Card>
    );
  }

  if (!answer && !isStreaming) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Answer</CardTitle>
          {confidence !== null && (
            <ConfidenceBadge confidence={confidence} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none">
          {answer}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const variant = confidence >= 0.7 ? 'default' : confidence >= 0.5 ? 'secondary' : 'destructive';
  const label = `${Math.round(confidence * 100)}% confident`;

  return <Badge variant={variant}>{label}</Badge>;
}
```

### CitationsList

```typescript
// src/components/features/qa/citations-list.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Citation } from '@/types/database';

interface CitationsListProps {
  citations: Citation[];
}

export function CitationsList({ citations }: CitationsListProps) {
  if (citations.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Sources</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {citations.map((citation, index) => (
            <CitationCard
              key={citation.chunk_id}
              citation={citation}
              index={index + 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CitationCard({
  citation,
  index
}: {
  citation: Citation;
  index: number;
}) {
  return (
    <div className="p-3 rounded-lg border bg-muted/50">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">
            {index}
          </span>
          <span className="font-medium text-sm">{citation.title}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {Math.round(citation.score * 100)}% match
        </span>
      </div>
      <p className="text-sm text-muted-foreground pl-8">
        "{citation.snippet}"
      </p>
    </div>
  );
}
```

### Chat Components (New)

The Q&A interface was enhanced with a chat-style UI featuring loading status indicators and inline citation chips.

#### ChatContainer

Main container managing chat history, streaming responses, and auto-scroll.

```typescript
// src/components/features/qa/ChatContainer.tsx
interface ChatContainerProps {
  tenantSlug: string;
  primaryColor?: string;
}
```

#### ChatMessage

Renders individual messages with markdown rendering and inline citation chips. Citations like `[Citation 1]` are replaced with clickable chips that show source document title.

```typescript
// src/components/features/qa/ChatMessage.tsx
interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  citations?: CitationData[];
  confidence?: number;
  loadingStatus?: LoadingStatus;
}

// Citation chip constants
const CITATION_MAX_DISPLAY_LENGTH = 16;  // Max chars before truncation
const CITATION_TRUNCATE_LENGTH = 13;     // Chars to show when truncated
const CITATION_REGEX = /\[Citation\s*(\d+)\]|\[(\d+)\]/gi;  // Match [Citation N] and [N]
```

Features:
- **Markdown rendering**: Uses `react-markdown` with custom Tailwind-styled components
  - Headings (h1-h3), bold, italic
  - Bullet/numbered lists
  - Inline and fenced code blocks
  - Blockquotes, tables, links
- **Inline citation chips**: Replace `[Citation N]` with styled chips showing truncated document title
- **Tooltip on hover**: Shows full document title
- **Clickable links**: Citations with source URL open in new tab
- **Error boundary**: `MarkdownErrorBoundary` class falls back to plain text if rendering fails
- **Memoization**: `useMemo` prevents re-rendering on every state change
- **Key generator factory**: `createKeyGenerator()` avoids mutable counter in render (React 18 concurrent mode compatible)

#### LoadingIndicator

Multi-stage loading status showing RAG pipeline progress:

```typescript
// src/components/features/qa/LoadingIndicator.tsx
type LoadingStatus =
  | 'searching'      // "Searching documents..."
  | 'analyzing'      // "Analyzing context..."
  | 'generating'     // "Generating response..."
  | 'complete';

interface LoadingIndicatorProps {
  status: LoadingStatus;
  primaryColor?: string;
}
```

#### ChatInput

Input field with suggestion chips and keyboard shortcuts:

```typescript
// src/components/features/qa/ChatInput.tsx
interface ChatInputProps {
  onSubmit: (message: string) => void;
  isLoading: boolean;
  suggestions?: string[];
  primaryColor?: string;
}
```

---

### QALogsTable

```typescript
// src/components/features/admin/qa-logs-table.tsx
'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QALog } from '@/types/database';
import { FlagButton } from './flag-button';

interface QALogsTableProps {
  logs: QALog[];
  onFlagToggle: (id: string, flagged: boolean, reason?: string) => void;
}

export function QALogsTable({ logs, onFlagToggle }: QALogsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Company</TableHead>
          <TableHead>Question</TableHead>
          <TableHead>Answer</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="font-medium">
              {log.company_slug}
            </TableCell>
            <TableCell className="max-w-[200px] truncate">
              {log.question}
            </TableCell>
            <TableCell className="max-w-[300px] truncate">
              {log.answer}
            </TableCell>
            <TableCell>
              <ConfidenceBadge confidence={log.confidence} />
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {new Date(log.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell>
              {log.flagged && (
                <Badge variant="destructive">Flagged</Badge>
              )}
            </TableCell>
            <TableCell>
              <FlagButton
                isFlagged={log.flagged}
                onToggle={(flagged, reason) => onFlagToggle(log.id, flagged, reason)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);

  if (percent >= 80) {
    return <Badge variant="default">{percent}%</Badge>;
  } else if (percent >= 60) {
    return <Badge variant="secondary">{percent}%</Badge>;
  } else {
    return <Badge variant="destructive">{percent}%</Badge>;
  }
}
```

### ColorPicker (for Branding)

```typescript
// src/components/ui/color-picker.tsx
'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-md border cursor-pointer overflow-hidden"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      <div className="flex-1 space-y-1">
        <Label>{label}</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="font-mono"
        />
      </div>
    </div>
  );
}
```

---

## Page Components

### Public Q&A Page

```typescript
// src/app/demo/[companySlug]/page.tsx

import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { QAInterface } from './qa-interface';

interface Props {
  params: { companySlug: string };
}

export default async function DemoPage({ params }: Props) {
  const supabase = createServerClient();

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('slug', params.companySlug)
    .eq('is_active', true)
    .single();

  if (!company) {
    notFound();
  }

  return (
    <div className="min-h-screen" style={{ fontFamily: 'var(--font-family)' }}>
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          {company.branding.logoUrl && (
            <img
              src={company.branding.logoUrl}
              alt={company.name}
              className="h-10 w-auto"
            />
          )}
          <h1 className="text-xl font-semibold">{company.name}</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <QAInterface
          companySlug={params.companySlug}
          branding={company.branding}
        />
      </main>
    </div>
  );
}
```

### Q&A Interface (Client Component)

```typescript
// src/app/demo/[companySlug]/qa-interface.tsx
'use client';

import { useStreamingResponse } from '@/hooks/use-streaming-response';
import { useCompanyTheme } from '@/hooks/use-company-theme';
import { QuestionForm } from '@/components/features/qa/question-form';
import { AnswerDisplay } from '@/components/features/qa/answer-display';
import { CitationsList } from '@/components/features/qa/citations-list';
import { CompanyBranding } from '@/types/database';

interface QAInterfaceProps {
  companySlug: string;
  branding: CompanyBranding;
}

export function QAInterface({ companySlug, branding }: QAInterfaceProps) {
  useCompanyTheme(branding);

  const {
    isLoading,
    isStreaming,
    answer,
    citations,
    confidence,
    error,
    askQuestion,
  } = useStreamingResponse();

  const handleSubmit = (question: string) => {
    askQuestion(companySlug, question);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Investor Q&A</h2>
        <p className="text-muted-foreground">
          Ask questions about our company disclosures and documents.
        </p>
      </div>

      <QuestionForm
        onSubmit={handleSubmit}
        isLoading={isLoading || isStreaming}
      />

      <AnswerDisplay
        answer={answer}
        confidence={confidence}
        isLoading={isLoading}
        isStreaming={isStreaming}
        error={error}
      />

      <CitationsList citations={citations} />
    </div>
  );
}
```

---

## CSS Custom Properties

```css
/* src/app/globals.css */

:root {
  /* Default theme (overridden by company branding) */
  --color-primary: #3B82F6;
  --color-secondary: #1E40AF;
  --color-background: #FFFFFF;
  --color-text: #1F2937;
  --color-accent: #10B981;
  --font-family: Inter, sans-serif;
  --border-radius: 8px;
}

/* Apply theme to components */
.themed-button {
  background-color: var(--color-primary);
  border-radius: var(--border-radius);
}

.themed-card {
  background-color: var(--color-background);
  color: var(--color-text);
  border-radius: var(--border-radius);
}

.themed-link {
  color: var(--color-accent);
}

/* Prose styling for answers */
.prose {
  font-family: var(--font-family);
  color: var(--color-text);
}
```

---

## Browser Compatibility

The tenant branding system uses modern CSS features. Ensure your target browsers support these features.

### Required CSS Features

| Feature | Minimum Browser Versions | Usage |
|---------|--------------------------|-------|
| CSS Custom Properties | Chrome 49+, Firefox 31+, Safari 9.1+, Edge 15+ | Tenant branding colors, fonts |
| `color-mix()` | Chrome 111+, Firefox 113+, Safari 16.2+, Edge 111+ | Transparent color overlays |
| CSS Gradients | Chrome 26+, Firefox 16+, Safari 7+, Edge 12+ | Primary/secondary gradients |

### `color-mix()` Usage

The chat components use `color-mix()` for semi-transparent backgrounds:

```css
/* Creates a 15% opacity version of the primary color */
background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);

/* Creates a 25% opacity shadow */
box-shadow: 0 10px 15px -3px color-mix(in srgb, var(--color-primary) 25%, transparent);
```

### Fallback Strategy

For browsers that don't support `color-mix()`:

1. **Progressive Enhancement**: The layout and functionality work without the feature; only subtle background tints are affected.
2. **Alternative**: If broader support is needed, replace `color-mix()` with fixed rgba colors or add a JavaScript polyfill.

### Minimum Supported Browsers

Based on the CSS features used:

- **Chrome/Edge**: 111+ (March 2023)
- **Firefox**: 113+ (May 2023)
- **Safari**: 16.2+ (December 2022)

For enterprise deployments requiring older browser support, consider replacing `color-mix()` with JavaScript-computed hex colors with opacity.

---

## Component File Structure

```
src/components/
├── ui/                          # Base shadcn/ui components
│   ├── button.tsx
│   ├── input.tsx
│   ├── textarea.tsx
│   ├── card.tsx
│   ├── table.tsx
│   ├── badge.tsx
│   ├── dialog.tsx
│   ├── skeleton.tsx
│   └── color-picker.tsx         # Custom component
│
├── layout/
│   ├── admin-sidebar.tsx        # Admin navigation
│   └── company-header.tsx       # Branded header for demo
│
├── features/
│   ├── qa/
│   │   ├── index.ts                 # Barrel exports + shared types
│   │   ├── ChatContainer.tsx        # Main chat container with history
│   │   ├── ChatInput.tsx            # Input with suggestion chips
│   │   ├── ChatMessage.tsx          # Message bubble with markdown + citations
│   │   ├── LoadingIndicator.tsx     # Multi-stage loading status
│   │   ├── question-form.tsx
│   │   ├── answer-display.tsx
│   │   ├── citations-list.tsx
│   │   ├── confidence-badge.tsx
│   │   └── __tests__/
│   │       └── ChatMessage.test.tsx # 23 tests for ChatMessage
│   │
│   └── admin/
│       ├── qa-logs-table.tsx
│       ├── flag-button.tsx
│       ├── company-form.tsx
│       └── branding-editor.tsx
│
└── documents/                       # Reusable document components
    ├── index.ts                     # Barrel exports
    ├── types.ts                     # Document/Tenant interfaces
    ├── constants.ts                 # DOC_TYPES, STATUS_COLORS, formatFileSize
    ├── ConfirmModal.tsx             # Reusable confirm dialog (danger/primary)
    ├── DocumentCard.tsx             # Document card with actions
    ├── DocumentViewModal.tsx        # Document details viewer
    ├── DocumentEditModal.tsx        # Document metadata editor
    └── UploadModal.tsx              # File upload with drag & drop

src/hooks/
├── useChat.ts                       # SSE streaming chat hook
└── __tests__/
    └── useChat.test.ts              # 17 tests for useChat hook
```

---

## Component Testing

Tests are co-located with components in `__tests__` folders and use Vitest with React Testing Library.

### Test Setup

```typescript
// vitest.setup.ts
import '@testing-library/jest-dom/vitest';  // Adds toBeInTheDocument(), toHaveClass(), etc.
```

For DOM tests, add the vitest environment directive:

```typescript
/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
```

### ChatMessage Tests (23 tests)

| Category | Tests |
|----------|-------|
| User messages | Renders with correct styling, plain text (no markdown) |
| Assistant messages | Renders with styling, markdown formatting (bold, italic, lists, code) |
| Citations | [Citation N] format, [N] format, truncation, links vs spans, missing citations |
| Streaming | Cursor visibility, loading status indicators |
| Confidence | Green/yellow/red badges, hidden when 0 or streaming |
| Error boundary | Fallback to plain text |

### useChat Tests (17 tests)

| Category | Tests |
|----------|-------|
| Initial state | Empty messages, not loading |
| sendMessage | Adds user/assistant messages, loading state, ignores empty |
| Streaming | Accumulates content, status updates, citations, confidence |
| Error handling | Fetch errors, status codes, SSE errors, abort handling |
| Session | clearMessages, session ID regeneration |
| Cleanup | AbortController cancellation on unmount |

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from '../useChat';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create a mock SSE response
function createSSEResponse(events: Array<{ event?: string; data: object }>) {
  const encoder = new TextEncoder();
  let index = 0;

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        let chunk = '';
        if (event.event) {
          chunk += `event: ${event.event}\n`;
        }
        chunk += `data: ${JSON.stringify(event.data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty messages', () => {
      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      expect(result.current.messages).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadingStatus).toBe(null);
      expect(result.current.error).toBe(null);
    });
  });

  describe('sendMessage', () => {
    it('adds user and assistant messages', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([
          { data: { content: 'Hello!' } },
        ])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Hi there');
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[0].content).toBe('Hi there');
      expect(result.current.messages[1].role).toBe('assistant');
      expect(result.current.messages[1].content).toBe('Hello!');
    });

    it('sets loading state during request', async () => {
      let resolveResponse: (value: Response) => void;
      const responsePromise = new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
      mockFetch.mockReturnValueOnce(responsePromise);

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      // Start sending (don't await)
      act(() => {
        result.current.sendMessage('Test');
      });

      // Should be loading
      expect(result.current.isLoading).toBe(true);

      // Resolve the response
      await act(async () => {
        resolveResponse!(createSSEResponse([{ data: { content: 'Response' } }]));
        // Wait for the hook to process
        await new Promise((r) => setTimeout(r, 100));
      });

      // Should no longer be loading
      expect(result.current.isLoading).toBe(false);
    });

    it('ignores empty messages', async () => {
      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('   ');
      });

      expect(result.current.messages).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('prevents concurrent requests', async () => {
      let resolveResponse: (value: Response) => void;
      const responsePromise = new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
      mockFetch.mockReturnValueOnce(responsePromise);

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      // Start first request
      act(() => {
        result.current.sendMessage('First');
      });

      // Try second request while first is loading
      await act(async () => {
        await result.current.sendMessage('Second');
      });

      // Should only have called fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Cleanup
      await act(async () => {
        resolveResponse!(createSSEResponse([{ data: { content: 'Done' } }]));
        await new Promise((r) => setTimeout(r, 100));
      });
    });

    it('sends correct request body', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([{ data: { content: 'Response' } }])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'my-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Test question');
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"question":"Test question"'),
        signal: expect.any(AbortSignal),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tenantSlug).toBe('my-tenant');
      expect(body.stream).toBe(true);
      expect(body.sessionId).toMatch(/^session-/);
    });
  });

  describe('streaming', () => {
    it('accumulates streaming content', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([
          { data: { content: 'Hello' } },
          { data: { content: ' world' } },
          { data: { content: '!' } },
        ])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Hi');
      });

      expect(result.current.messages[1].content).toBe('Hello world!');
    });

    it('updates loading status from stream', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([
          { data: { status: 'searching' } },
          { data: { status: 'generating' } },
          { data: { content: 'Answer' } },
        ])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      // After completion, status should be null
      expect(result.current.loadingStatus).toBe(null);
    });

    it('receives citations from stream', async () => {
      const mockCitations = [
        { id: 1, documentTitle: 'Doc 1', snippet: 'Text', confidence: 0.9 },
      ];

      mockFetch.mockResolvedValueOnce(
        createSSEResponse([
          { data: { content: 'Answer with [Citation 1]' } },
          { data: { citations: mockCitations } },
        ])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      expect(result.current.messages[1].citations).toEqual(mockCitations);
    });

    it('receives confidence from stream', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([
          { data: { content: 'Answer' } },
          { data: { confidence: 0.85 } },
        ])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      expect(result.current.messages[1].confidence).toBe(0.85);
    });
  });

  describe('error handling', () => {
    it('handles fetch errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const onError = vi.fn();
      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant', onError })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      expect(result.current.error).toBe('Network error');
      expect(onError).toHaveBeenCalledWith('Network error');
      expect(result.current.messages[1].content).toContain('error');
    });

    it('handles non-ok response status', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 500 })
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      expect(result.current.error).toBe('Request failed: 500');
    });

    it('handles error in SSE stream', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([
          { data: { content: 'Starting...' } },
          { data: { error: 'Server error occurred' } },
        ])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      expect(result.current.error).toBe('Server error occurred');
    });

    it('ignores abort errors', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const onError = vi.fn();
      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant', onError })
      );

      await act(async () => {
        await result.current.sendMessage('Question');
      });

      // Should not set error for abort
      expect(result.current.error).toBe(null);
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('clearMessages', () => {
    it('clears all messages', async () => {
      mockFetch.mockResolvedValueOnce(
        createSSEResponse([{ data: { content: 'Response' } }])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(result.current.messages).toHaveLength(2);

      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages).toHaveLength(0);
      expect(result.current.error).toBe(null);
    });

    it('generates new session ID on clear', async () => {
      mockFetch.mockResolvedValue(
        createSSEResponse([{ data: { content: 'Response' } }])
      );

      const { result } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      // First message
      await act(async () => {
        await result.current.sendMessage('First');
      });

      const firstSessionId = JSON.parse(mockFetch.mock.calls[0][1].body).sessionId;

      // Clear and send second message
      act(() => {
        result.current.clearMessages();
      });

      await act(async () => {
        await result.current.sendMessage('Second');
      });

      const secondSessionId = JSON.parse(mockFetch.mock.calls[1][1].body).sessionId;

      expect(firstSessionId).not.toBe(secondSessionId);
    });
  });

  describe('abort controller', () => {
    it('aborts previous request when sending new one', async () => {
      let firstAbortSignal: AbortSignal;

      mockFetch.mockImplementation((_url, options) => {
        firstAbortSignal = options.signal;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(createSSEResponse([{ data: { content: 'Done' } }]));
          }, 1000);
        });
      });

      const { result, unmount } = renderHook(() =>
        useChat({ tenantSlug: 'test-tenant' })
      );

      // Start first request
      act(() => {
        result.current.sendMessage('First');
      });

      // Wait a bit for the request to start
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // The signal should exist but not be aborted yet
      expect(firstAbortSignal!).toBeDefined();

      // Unmount to trigger cleanup
      unmount();

      // After unmount, the signal should be aborted
      expect(firstAbortSignal!.aborted).toBe(true);
    });
  });
});

/**
 * Tests for Supabase Project Provisioning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateProvisioningCredentials,
  isProvisioningConfigured,
  provisionSupabaseProject,
  deleteSupabaseProject,
  pauseSupabaseProject,
  resumeSupabaseProject,
  listSupabaseProjects,
} from '../provisioning';

// =============================================================================
// Test Setup
// =============================================================================

// Store original env values
const originalEnv = { ...process.env };

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);

  // Set up valid credentials by default
  process.env.SUPABASE_ACCESS_TOKEN = 'sbp_test_token';
  process.env.SUPABASE_ORG_ID = 'test-org-id';
  process.env.SUPABASE_DEFAULT_REGION = 'us-east-1';
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore original env
  process.env = { ...originalEnv };
});

// =============================================================================
// Helper Functions
// =============================================================================

function mockFetchResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(message: string, status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
    text: () => Promise.resolve(JSON.stringify({ message })),
  });
}

// =============================================================================
// validateProvisioningCredentials Tests
// =============================================================================

describe('validateProvisioningCredentials', () => {
  it('should not throw when credentials are configured', () => {
    expect(() => validateProvisioningCredentials()).not.toThrow();
  });

  it('should throw when SUPABASE_ACCESS_TOKEN is missing', () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    expect(() => validateProvisioningCredentials()).toThrow(
      /SUPABASE_ACCESS_TOKEN/
    );
  });

  it('should throw when SUPABASE_ORG_ID is missing', () => {
    delete process.env.SUPABASE_ORG_ID;

    expect(() => validateProvisioningCredentials()).toThrow(/SUPABASE_ORG_ID/);
  });

  it('should throw when both credentials are missing', () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    delete process.env.SUPABASE_ORG_ID;

    expect(() => validateProvisioningCredentials()).toThrow(
      /SUPABASE_ACCESS_TOKEN.*SUPABASE_ORG_ID|SUPABASE_ORG_ID.*SUPABASE_ACCESS_TOKEN/
    );
  });

  it('should include help URL in error message', () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    expect(() => validateProvisioningCredentials()).toThrow(
      /supabase\.com\/dashboard\/account\/tokens/
    );
  });
});

// =============================================================================
// isProvisioningConfigured Tests
// =============================================================================

describe('isProvisioningConfigured', () => {
  it('should return true when both credentials are set', () => {
    expect(isProvisioningConfigured()).toBe(true);
  });

  it('should return false when SUPABASE_ACCESS_TOKEN is missing', () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    expect(isProvisioningConfigured()).toBe(false);
  });

  it('should return false when SUPABASE_ORG_ID is missing', () => {
    delete process.env.SUPABASE_ORG_ID;
    expect(isProvisioningConfigured()).toBe(false);
  });

  it('should return false when both are missing', () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    delete process.env.SUPABASE_ORG_ID;
    expect(isProvisioningConfigured()).toBe(false);
  });

  it('should return false for empty string values', () => {
    process.env.SUPABASE_ACCESS_TOKEN = '';
    expect(isProvisioningConfigured()).toBe(false);
  });
});

// =============================================================================
// provisionSupabaseProject Tests
// =============================================================================

describe('provisionSupabaseProject', () => {
  const mockProjectResponse = {
    id: 'project-123',
    ref: 'abcdefgh',
    name: 'tenant-test-tenant',
    status: 'COMING_UP',
    region: 'us-east-1',
    created_at: '2024-01-01T00:00:00Z',
  };

  const mockApiKeys = [
    { name: 'anon', api_key: 'anon-key-123' },
    { name: 'service_role', api_key: 'service-key-456' },
  ];

  it('should throw when credentials are not configured', async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /SUPABASE_ACCESS_TOKEN/
    );
  });

  it('should create project and return credentials', async () => {
    // Mock create project
    mockFetchResponse(mockProjectResponse);

    // Mock status poll - immediately ready
    mockFetchResponse({ ...mockProjectResponse, status: 'ACTIVE_HEALTHY' });

    // Mock API keys
    mockFetchResponse(mockApiKeys);

    const result = await provisionSupabaseProject('test-tenant');

    expect(result.projectRef).toBe('abcdefgh');
    expect(result.anonKey).toBe('anon-key-123');
    expect(result.serviceKey).toBe('service-key-456');
    expect(result.apiUrl).toBe('https://abcdefgh.supabase.co');
    expect(result.databaseUrl).toContain('postgres.abcdefgh');
    expect(result.databaseUrl).toContain('pooler.supabase.com');
  });

  it('should use custom region when provided', async () => {
    mockFetchResponse({ ...mockProjectResponse, region: 'eu-west-1' });
    mockFetchResponse({ ...mockProjectResponse, status: 'ACTIVE_HEALTHY', region: 'eu-west-1' });
    mockFetchResponse(mockApiKeys);

    await provisionSupabaseProject('test-tenant', 'eu-west-1');

    // Check that the create project call included the region
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"region":"eu-west-1"'),
      })
    );
  });

  it('should handle 401 authentication error', async () => {
    mockFetchError('Invalid token', 401);

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /authentication failed/i
    );
  });

  it('should handle 403 forbidden error', async () => {
    mockFetchError('Forbidden', 403);

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /access denied/i
    );
  });

  it('should handle 429 rate limit error', async () => {
    mockFetchError('Rate limited', 429);

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /rate limit/i
    );
  });

  it('should handle 402 quota exceeded error', async () => {
    mockFetchError('Quota exceeded', 402);

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /quota exceeded/i
    );
  });

  it('should handle missing API keys', async () => {
    mockFetchResponse(mockProjectResponse);
    mockFetchResponse({ ...mockProjectResponse, status: 'ACTIVE_HEALTHY' });
    // Return empty keys array
    mockFetchResponse([]);

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /Failed to retrieve API keys/
    );
  });

  it('should handle project entering INACTIVE status', async () => {
    mockFetchResponse(mockProjectResponse);
    mockFetchResponse({ ...mockProjectResponse, status: 'INACTIVE' });

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /unexpected status.*INACTIVE/i
    );
  });

  it('should include authorization header in requests', async () => {
    mockFetchResponse(mockProjectResponse);
    mockFetchResponse({ ...mockProjectResponse, status: 'ACTIVE_HEALTHY' });
    mockFetchResponse(mockApiKeys);

    await provisionSupabaseProject('test-tenant');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sbp_test_token',
        }),
      })
    );
  });

  it('should handle generic API error', async () => {
    mockFetchError('Unknown error', 500);

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /Supabase API error.*500/
    );
  });

  it('should handle non-JSON error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Not JSON')),
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(provisionSupabaseProject('test-tenant')).rejects.toThrow(
      /Internal Server Error/
    );
  });
});

// =============================================================================
// deleteSupabaseProject Tests
// =============================================================================

describe('deleteSupabaseProject', () => {
  it('should throw when credentials are not configured', async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    await expect(deleteSupabaseProject('test-ref')).rejects.toThrow(
      /SUPABASE_ACCESS_TOKEN/
    );
  });

  it('should call DELETE endpoint', async () => {
    mockFetchResponse({});

    await deleteSupabaseProject('test-ref');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects/test-ref',
      expect.objectContaining({
        method: 'DELETE',
      })
    );
  });

  it('should handle deletion error', async () => {
    mockFetchError('Project not found', 404);

    await expect(deleteSupabaseProject('invalid-ref')).rejects.toThrow();
  });
});

// =============================================================================
// pauseSupabaseProject Tests
// =============================================================================

describe('pauseSupabaseProject', () => {
  it('should throw when credentials are not configured', async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    await expect(pauseSupabaseProject('test-ref')).rejects.toThrow();
  });

  it('should call pause endpoint', async () => {
    mockFetchResponse({});

    await pauseSupabaseProject('test-ref');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects/test-ref/pause',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});

// =============================================================================
// resumeSupabaseProject Tests
// =============================================================================

describe('resumeSupabaseProject', () => {
  it('should throw when credentials are not configured', async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    await expect(resumeSupabaseProject('test-ref')).rejects.toThrow();
  });

  it('should call restore endpoint', async () => {
    mockFetchResponse({});

    await resumeSupabaseProject('test-ref');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects/test-ref/restore',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});

// =============================================================================
// listSupabaseProjects Tests
// =============================================================================

describe('listSupabaseProjects', () => {
  it('should throw when credentials are not configured', async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    await expect(listSupabaseProjects()).rejects.toThrow();
  });

  it('should return list of projects', async () => {
    const mockProjects = [
      { id: '1', ref: 'abc', name: 'project-1', status: 'ACTIVE_HEALTHY' },
      { id: '2', ref: 'def', name: 'project-2', status: 'PAUSED' },
    ];
    mockFetchResponse(mockProjects);

    const result = await listSupabaseProjects();

    expect(result).toHaveLength(2);
    expect(result[0].ref).toBe('abc');
    expect(result[1].status).toBe('PAUSED');
  });

  it('should return empty array when no projects', async () => {
    mockFetchResponse([]);

    const result = await listSupabaseProjects();

    expect(result).toEqual([]);
  });
});

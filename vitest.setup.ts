/**
 * Vitest Setup File
 *
 * Global test setup and mocks.
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock environment variables for tests
process.env.MASTER_KEY = 'dGVzdC1rZXktMzItYnl0ZXMtZm9yLXZpdGVzdCEhYWI='; // 32 bytes base64
process.env.OPENAI_API_KEY = 'sk-test-key-for-testing';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Mock console.warn and console.error to keep test output clean
// Comment these out when debugging tests
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});

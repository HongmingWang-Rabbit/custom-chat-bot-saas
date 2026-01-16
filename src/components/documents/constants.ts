/**
 * Shared constants for document components
 */

export const DOC_TYPES = [
  { value: 'disclosure', label: 'Disclosure' },
  { value: 'faq', label: 'FAQ' },
  { value: 'report', label: 'Report' },
  { value: 'filing', label: 'Filing' },
  { value: 'other', label: 'Other' },
] as const;

export const SUPPORTED_FILE_TYPES = ['.pdf', '.txt', '.md', '.docx'] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const STATUS_COLORS: Record<string, string> = {
  ready: 'bg-green-100 text-green-700',
  processing: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
};

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

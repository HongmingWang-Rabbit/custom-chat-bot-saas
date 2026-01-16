/**
 * Shared types for document components
 */

export interface Document {
  id: string;
  title: string;
  docType: string;
  status: string;
  chunkCount: number;
  fileSize: number | null;
  hasOriginalFile?: boolean;
  createdAt: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

export type DocumentStatus = 'ready' | 'processing' | 'pending' | 'error';

export type DocType = 'disclosure' | 'faq' | 'report' | 'filing' | 'other';

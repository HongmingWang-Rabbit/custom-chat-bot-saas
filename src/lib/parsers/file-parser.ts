/**
 * File Parser Utility
 *
 * Extracts text content from various file formats:
 * - PDF (.pdf)
 * - Plain text (.txt)
 * - Markdown (.md)
 * - Word documents (.docx)
 */

import mammoth from 'mammoth';

// pdf-parse v2.x has a class-based API
// Use dynamic import to avoid type definition issues
interface PDFParserInstance {
  load(): Promise<void>;
  getText(): Promise<string>;
  destroy(): void;
}

interface PDFParseConstructor {
  new (options: { data: Buffer }): PDFParserInstance;
}

let PDFParseClass: PDFParseConstructor | null = null;

async function getPDFParser(): Promise<PDFParseConstructor> {
  if (!PDFParseClass) {
    const mod = await import('pdf-parse');
    // Cast through unknown to avoid private property type conflicts
    PDFParseClass = (mod as unknown as { PDFParse: PDFParseConstructor }).PDFParse;
  }
  return PDFParseClass;
}

// =============================================================================
// Types
// =============================================================================

export interface ParseResult {
  content: string;
  metadata: {
    pageCount?: number;
    wordCount: number;
    charCount: number;
  };
}

export type SupportedMimeType =
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const SUPPORTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export const MIME_TYPE_MAP: Record<SupportedExtension, SupportedMimeType> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// =============================================================================
// File Type Detection
// =============================================================================

/**
 * Get file extension from filename.
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Check if file type is supported.
 */
export function isSupportedFileType(filename: string): boolean {
  const ext = getFileExtension(filename);
  return SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension);
}

/**
 * Get MIME type from filename.
 */
export function getMimeType(filename: string): SupportedMimeType | null {
  const ext = getFileExtension(filename) as SupportedExtension;
  return MIME_TYPE_MAP[ext] || null;
}

// =============================================================================
// Parsers
// =============================================================================

/**
 * Parse PDF file and extract text.
 */
async function parsePDF(buffer: Buffer): Promise<ParseResult> {
  const PDFParse = await getPDFParser();
  const parser = new PDFParse({ data: buffer });
  await parser.load();

  const result = await parser.getText();
  parser.destroy();

  // getText() returns { pages, text, total }
  const rawText = typeof result === 'string' ? result : (result as { text: string }).text || '';

  const content = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/-- \d+ of \d+ --/g, '') // Remove page markers
    .trim();

  return {
    content,
    metadata: {
      wordCount: content.split(/\s+/).filter(Boolean).length,
      charCount: content.length,
    },
  };
}

/**
 * Parse plain text file.
 */
async function parseText(buffer: Buffer): Promise<ParseResult> {
  const content = buffer.toString('utf-8').trim();

  return {
    content,
    metadata: {
      wordCount: content.split(/\s+/).filter(Boolean).length,
      charCount: content.length,
    },
  };
}

/**
 * Parse Markdown file (treat as plain text, preserve formatting).
 */
async function parseMarkdown(buffer: Buffer): Promise<ParseResult> {
  const content = buffer.toString('utf-8').trim();

  return {
    content,
    metadata: {
      wordCount: content.split(/\s+/).filter(Boolean).length,
      charCount: content.length,
    },
  };
}

/**
 * Parse DOCX file and extract text.
 */
async function parseDOCX(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer });

  const content = result.value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    content,
    metadata: {
      wordCount: content.split(/\s+/).filter(Boolean).length,
      charCount: content.length,
    },
  };
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a file and extract text content.
 *
 * @param buffer - File contents as Buffer
 * @param filename - Original filename (for type detection)
 * @returns Parsed content and metadata
 * @throws Error if file type is not supported
 */
export async function parseFile(
  buffer: Buffer,
  filename: string
): Promise<ParseResult> {
  const ext = getFileExtension(filename);

  if (!isSupportedFileType(filename)) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }

  switch (ext) {
    case '.pdf':
      return parsePDF(buffer);
    case '.txt':
      return parseText(buffer);
    case '.md':
      return parseMarkdown(buffer);
    case '.docx':
      return parseDOCX(buffer);
    default:
      throw new Error(`No parser available for: ${ext}`);
  }
}

/**
 * Validate file before parsing.
 */
export function validateFile(
  file: { name: string; size: number }
): { valid: boolean; error?: string } {
  if (!isSupportedFileType(file.name)) {
    return {
      valid: false,
      error: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty',
    };
  }

  return { valid: true };
}

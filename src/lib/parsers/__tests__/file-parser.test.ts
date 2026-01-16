/**
 * Tests for file parser utility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseFile,
  validateFile,
  isSupportedFileType,
  getFileExtension,
  getMimeType,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from '../file-parser';

// Mock pdf-parse (v2.x class-based API)
const mockPDFGetText = vi.fn();
const mockPDFLoad = vi.fn();
const mockPDFDestroy = vi.fn();

class MockPDFParse {
  load = mockPDFLoad;
  getText = mockPDFGetText;
  destroy = mockPDFDestroy;
}

vi.mock('pdf-parse', () => ({
  PDFParse: MockPDFParse,
}));

// Mock mammoth
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

// =============================================================================
// Test Fixtures
// =============================================================================

const createTextBuffer = (content: string): Buffer => Buffer.from(content, 'utf-8');

const sampleText = `
This is a sample document for testing purposes.

It contains multiple paragraphs with various content.
The parser should extract all text correctly.

Key points:
- First item
- Second item
- Third item

Conclusion: Testing is important.
`.trim();

// =============================================================================
// Tests: File Extension Detection
// =============================================================================

describe('file-parser', () => {
  describe('getFileExtension', () => {
    it('should extract extension from filename', () => {
      expect(getFileExtension('document.pdf')).toBe('.pdf');
      expect(getFileExtension('report.txt')).toBe('.txt');
      expect(getFileExtension('notes.md')).toBe('.md');
      expect(getFileExtension('file.docx')).toBe('.docx');
    });

    it('should handle uppercase extensions', () => {
      expect(getFileExtension('DOCUMENT.PDF')).toBe('.pdf');
      expect(getFileExtension('Report.TXT')).toBe('.txt');
    });

    it('should handle files with multiple dots', () => {
      expect(getFileExtension('report.2024.final.pdf')).toBe('.pdf');
      expect(getFileExtension('my.file.name.txt')).toBe('.txt');
    });

    it('should return empty string for no extension', () => {
      expect(getFileExtension('README')).toBe('');
      expect(getFileExtension('Makefile')).toBe('');
    });

    it('should handle hidden files', () => {
      expect(getFileExtension('.gitignore')).toBe('.gitignore');
      expect(getFileExtension('.env.local')).toBe('.local');
    });
  });

  describe('isSupportedFileType', () => {
    it('should return true for supported types', () => {
      expect(isSupportedFileType('document.pdf')).toBe(true);
      expect(isSupportedFileType('notes.txt')).toBe(true);
      expect(isSupportedFileType('readme.md')).toBe(true);
      expect(isSupportedFileType('report.docx')).toBe(true);
    });

    it('should return false for unsupported types', () => {
      expect(isSupportedFileType('image.png')).toBe(false);
      expect(isSupportedFileType('data.json')).toBe(false);
      expect(isSupportedFileType('script.js')).toBe(false);
      expect(isSupportedFileType('archive.zip')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isSupportedFileType('DOCUMENT.PDF')).toBe(true);
      expect(isSupportedFileType('Notes.TXT')).toBe(true);
    });
  });

  describe('getMimeType', () => {
    it('should return correct MIME type for supported files', () => {
      expect(getMimeType('file.pdf')).toBe('application/pdf');
      expect(getMimeType('file.txt')).toBe('text/plain');
      expect(getMimeType('file.md')).toBe('text/markdown');
      expect(getMimeType('file.docx')).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    });

    it('should return null for unsupported files', () => {
      expect(getMimeType('file.png')).toBeNull();
      expect(getMimeType('file.json')).toBeNull();
    });
  });

  // =============================================================================
  // Tests: File Validation
  // =============================================================================

  describe('validateFile', () => {
    it('should accept valid files', () => {
      const result = validateFile({ name: 'document.pdf', size: 1024 });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject unsupported file types', () => {
      const result = validateFile({ name: 'image.png', size: 1024 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported file type');
    });

    it('should reject files that are too large', () => {
      const result = validateFile({ name: 'large.pdf', size: MAX_FILE_SIZE + 1 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should reject empty files', () => {
      const result = validateFile({ name: 'empty.pdf', size: 0 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should accept files at exactly max size', () => {
      const result = validateFile({ name: 'maxsize.pdf', size: MAX_FILE_SIZE });
      expect(result.valid).toBe(true);
    });
  });

  // =============================================================================
  // Tests: Text Parsing
  // =============================================================================

  describe('parseFile - TXT', () => {
    it('should parse plain text files', async () => {
      const buffer = createTextBuffer(sampleText);
      const result = await parseFile(buffer, 'document.txt');

      expect(result.content).toBe(sampleText);
      expect(result.metadata.charCount).toBe(sampleText.length);
      expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it('should handle empty text file', async () => {
      const buffer = createTextBuffer('');
      const result = await parseFile(buffer, 'empty.txt');

      expect(result.content).toBe('');
      expect(result.metadata.charCount).toBe(0);
      expect(result.metadata.wordCount).toBe(0);
    });

    it('should preserve whitespace structure', async () => {
      const textWithWhitespace = 'Line 1\n\nLine 2\n\n\nLine 3';
      const buffer = createTextBuffer(textWithWhitespace);
      const result = await parseFile(buffer, 'file.txt');

      expect(result.content).toContain('\n\n');
    });

    it('should handle unicode content', async () => {
      const unicodeText = 'Hello 世界! Émojis: 🎉 Math: ∑∏∫';
      const buffer = createTextBuffer(unicodeText);
      const result = await parseFile(buffer, 'unicode.txt');

      expect(result.content).toBe(unicodeText);
    });
  });

  describe('parseFile - Markdown', () => {
    it('should parse markdown files', async () => {
      const markdown = `# Heading

This is a paragraph.

## Subheading

- Item 1
- Item 2

\`\`\`code\`\`\`
`;
      const buffer = createTextBuffer(markdown);
      const result = await parseFile(buffer, 'readme.md');

      expect(result.content).toContain('# Heading');
      expect(result.content).toContain('## Subheading');
      expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it('should preserve markdown formatting', async () => {
      const markdown = '**bold** and *italic* and `code`';
      const buffer = createTextBuffer(markdown);
      const result = await parseFile(buffer, 'file.md');

      expect(result.content).toContain('**bold**');
      expect(result.content).toContain('*italic*');
    });
  });

  // =============================================================================
  // Tests: Error Handling
  // =============================================================================

  describe('parseFile - Error handling', () => {
    it('should throw for unsupported file types', async () => {
      const buffer = createTextBuffer('content');

      await expect(parseFile(buffer, 'image.png')).rejects.toThrow(
        'Unsupported file type'
      );
    });

    it('should throw for files with no extension', async () => {
      const buffer = createTextBuffer('content');

      await expect(parseFile(buffer, 'README')).rejects.toThrow(
        'Unsupported file type'
      );
    });

    it('should include supported types in error message', async () => {
      const buffer = createTextBuffer('content');

      try {
        await parseFile(buffer, 'file.xyz');
      } catch (error) {
        expect((error as Error).message).toContain('.pdf');
        expect((error as Error).message).toContain('.txt');
      }
    });
  });

  // =============================================================================
  // Tests: Metadata
  // =============================================================================

  describe('parseFile - Metadata', () => {
    it('should calculate word count correctly', async () => {
      const text = 'one two three four five';
      const buffer = createTextBuffer(text);
      const result = await parseFile(buffer, 'file.txt');

      expect(result.metadata.wordCount).toBe(5);
    });

    it('should calculate character count correctly', async () => {
      const text = 'Hello World';
      const buffer = createTextBuffer(text);
      const result = await parseFile(buffer, 'file.txt');

      expect(result.metadata.charCount).toBe(11);
    });

    it('should handle multiple whitespace in word count', async () => {
      const text = 'word1    word2\n\nword3\t\tword4';
      const buffer = createTextBuffer(text);
      const result = await parseFile(buffer, 'file.txt');

      expect(result.metadata.wordCount).toBe(4);
    });
  });

  // =============================================================================
  // Tests: Constants
  // =============================================================================

  describe('Constants', () => {
    it('should have correct supported extensions', () => {
      expect(SUPPORTED_EXTENSIONS).toContain('.pdf');
      expect(SUPPORTED_EXTENSIONS).toContain('.txt');
      expect(SUPPORTED_EXTENSIONS).toContain('.md');
      expect(SUPPORTED_EXTENSIONS).toContain('.docx');
      expect(SUPPORTED_EXTENSIONS).toHaveLength(4);
    });

    it('should have reasonable max file size', () => {
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024); // 10MB
    });
  });

  // =============================================================================
  // Tests: PDF Parsing (mocked)
  // =============================================================================

  describe('parseFile - PDF', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockPDFLoad.mockResolvedValue(undefined);
    });

    it('should parse PDF files and extract text', async () => {
      mockPDFGetText.mockResolvedValue('This is PDF content.\r\n\r\nSecond paragraph.');

      const buffer = Buffer.from('fake pdf content');
      const result = await parseFile(buffer, 'document.pdf');

      expect(result.content).toContain('This is PDF content');
      expect(result.content).toContain('Second paragraph');
      expect(result.metadata.wordCount).toBeGreaterThan(0);
      expect(mockPDFDestroy).toHaveBeenCalled();
    });

    it('should normalize line endings in PDF', async () => {
      mockPDFGetText.mockResolvedValue('Line1\r\nLine2\r\n\r\n\r\n\r\nLine3');

      const buffer = Buffer.from('fake pdf');
      const result = await parseFile(buffer, 'doc.pdf');

      expect(result.content).not.toContain('\r\n');
      // Should collapse multiple newlines
      expect(result.content).not.toContain('\n\n\n');
    });

    it('should handle PDF parsing errors', async () => {
      mockPDFLoad.mockRejectedValue(new Error('Invalid PDF'));

      const buffer = Buffer.from('not a real pdf');

      await expect(parseFile(buffer, 'bad.pdf')).rejects.toThrow('Invalid PDF');
    });
  });

  // =============================================================================
  // Tests: DOCX Parsing (mocked)
  // =============================================================================

  describe('parseFile - DOCX', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should parse DOCX files and extract text', async () => {
      const mammoth = await import('mammoth');
      const mockExtract = mammoth.default.extractRawText as ReturnType<typeof vi.fn>;
      mockExtract.mockResolvedValue({
        value: 'This is DOCX content.\r\n\r\nAnother paragraph.',
        messages: [],
      });

      const buffer = Buffer.from('fake docx content');
      const result = await parseFile(buffer, 'document.docx');

      expect(result.content).toContain('This is DOCX content');
      expect(result.content).toContain('Another paragraph');
      expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it('should normalize line endings in DOCX', async () => {
      const mammoth = await import('mammoth');
      const mockExtract = mammoth.default.extractRawText as ReturnType<typeof vi.fn>;
      mockExtract.mockResolvedValue({
        value: 'Line1\r\nLine2\r\n\r\n\r\n\r\nLine3',
        messages: [],
      });

      const buffer = Buffer.from('fake docx');
      const result = await parseFile(buffer, 'doc.docx');

      expect(result.content).not.toContain('\r\n');
    });

    it('should handle DOCX parsing errors', async () => {
      const mammoth = await import('mammoth');
      const mockExtract = mammoth.default.extractRawText as ReturnType<typeof vi.fn>;
      mockExtract.mockRejectedValue(new Error('Invalid DOCX'));

      const buffer = Buffer.from('not a real docx');

      await expect(parseFile(buffer, 'bad.docx')).rejects.toThrow('Invalid DOCX');
    });
  });
});

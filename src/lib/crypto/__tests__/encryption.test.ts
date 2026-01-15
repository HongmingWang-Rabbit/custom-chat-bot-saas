/**
 * Tests for AES-256-GCM encryption utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  secureCompare,
  generateKey,
  isEncrypted,
  clearSensitiveData,
} from '../encryption';

describe('encryption', () => {
  describe('encrypt', () => {
    it('should encrypt plaintext and return formatted string', () => {
      const plaintext = 'secret-database-url';
      const encrypted = encrypt(plaintext);

      // Should be in format: iv:authTag:ciphertext (all base64)
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);

      // Each part should be valid base64
      parts.forEach((part) => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });

    it('should produce different output for same input (random IV)', () => {
      const plaintext = 'test-secret';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      // Should be different due to random IV
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty string', () => {
      const encrypted = encrypt('');
      expect(encrypted).toBeTruthy();
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('should handle special characters', () => {
      const plaintext = 'postgresql://user:p@ss=word!@host:5432/db?ssl=true';
      const encrypted = encrypt(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('should handle unicode characters', () => {
      const plaintext = '密码：秘密数据 🔐';
      const encrypted = encrypt(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('should handle long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = encrypt(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted text back to original', () => {
      const plaintext = 'secret-database-url';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should roundtrip empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should roundtrip special characters', () => {
      const plaintext = 'postgresql://user:p@ss=word!@host:5432/db?ssl=true&option=value';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should roundtrip unicode characters', () => {
      const plaintext = '密码：秘密数据 🔐 émojis';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should roundtrip long strings', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on invalid format', () => {
      expect(() => decrypt('not-valid-format')).toThrow();
      expect(() => decrypt('only:two:parts:extra')).toThrow();
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');

      // Tamper with the ciphertext
      const tamperedCiphertext = Buffer.from('tampered').toString('base64');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');

      // Tamper with the auth tag
      const tamperedTag = Buffer.from('0'.repeat(16)).toString('base64');
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on invalid base64', () => {
      expect(() => decrypt('!!!:@@@:###')).toThrow();
    });
  });

  describe('security properties', () => {
    it('should use 16-byte IV (128 bits)', () => {
      const encrypted = encrypt('test');
      const [ivBase64] = encrypted.split(':');
      const iv = Buffer.from(ivBase64, 'base64');

      expect(iv.length).toBe(16);
    });

    it('should use 16-byte auth tag (128 bits)', () => {
      const encrypted = encrypt('test');
      const [, authTagBase64] = encrypted.split(':');
      const authTag = Buffer.from(authTagBase64, 'base64');

      expect(authTag.length).toBe(16);
    });

    it('should produce ciphertext of appropriate length', () => {
      const plaintext = 'test-secret-123';
      const encrypted = encrypt(plaintext);
      const [,, ciphertextBase64] = encrypted.split(':');
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');

      // GCM mode: ciphertext length equals plaintext length
      expect(ciphertext.length).toBe(plaintext.length);
    });

    it('should throw on invalid IV length', () => {
      // Create encrypted data with wrong IV length
      const shortIv = Buffer.from('short').toString('base64');
      const validTag = Buffer.alloc(16).toString('base64');
      const validCiphertext = Buffer.from('test').toString('base64');
      const invalid = `${shortIv}:${validTag}:${validCiphertext}`;

      expect(() => decrypt(invalid)).toThrow('Invalid IV length');
    });

    it('should throw on invalid auth tag length', () => {
      // Create encrypted data with wrong auth tag length
      const validIv = Buffer.alloc(16).toString('base64');
      const shortTag = Buffer.from('short').toString('base64');
      const validCiphertext = Buffer.from('test').toString('base64');
      const invalid = `${validIv}:${shortTag}:${validCiphertext}`;

      expect(() => decrypt(invalid)).toThrow('Invalid auth tag length');
    });
  });

  describe('secureCompare', () => {
    it('should return true for equal strings', () => {
      expect(secureCompare('test', 'test')).toBe(true);
      expect(secureCompare('', '')).toBe(true);
      expect(secureCompare('abc123', 'abc123')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(secureCompare('test', 'Test')).toBe(false);
      expect(secureCompare('abc', 'abd')).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(secureCompare('short', 'longer')).toBe(false);
      expect(secureCompare('a', 'aa')).toBe(false);
    });
  });

  describe('generateKey', () => {
    it('should generate a valid base64 key', () => {
      const key = generateKey();
      expect(typeof key).toBe('string');

      // Should be valid base64
      const decoded = Buffer.from(key, 'base64');
      expect(decoded.length).toBe(32); // 256 bits
    });

    it('should generate different keys each time', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted data', () => {
      const encrypted = encrypt('test');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext', () => {
      expect(isEncrypted('not encrypted')).toBe(false);
      expect(isEncrypted('just:two:parts')).toBe(false);
    });

    it('should return false for wrong format', () => {
      expect(isEncrypted('single')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for invalid IV/tag lengths', () => {
      const shortIv = Buffer.from('short').toString('base64');
      const validTag = Buffer.alloc(16).toString('base64');
      const data = Buffer.from('data').toString('base64');

      expect(isEncrypted(`${shortIv}:${validTag}:${data}`)).toBe(false);
    });
  });

  describe('clearSensitiveData', () => {
    it('should clear string properties', () => {
      const obj = { secret: 'password', key: 'api-key' };
      clearSensitiveData(obj);

      expect(obj.secret).toBe('');
      expect(obj.key).toBe('');
    });

    it('should preserve non-string properties', () => {
      const obj = { count: 42, flag: true, secret: 'password' };
      clearSensitiveData(obj);

      expect(obj.count).toBe(42);
      expect(obj.flag).toBe(true);
      expect(obj.secret).toBe('');
    });

    it('should handle empty objects', () => {
      const obj = {};
      expect(() => clearSensitiveData(obj)).not.toThrow();
    });
  });
});

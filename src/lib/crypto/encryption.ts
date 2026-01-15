import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;          // 128 bits
const AUTH_TAG_LENGTH = 16;    // 128 bits
const KEY_LENGTH = 32;         // 256 bits

/**
 * Get the master encryption key from environment.
 * Key must be 32 bytes (256 bits) for AES-256.
 *
 * Generate a key with: openssl rand -base64 32
 */
function getMasterKey(): Buffer {
  const masterKey = process.env.MASTER_KEY;

  if (!masterKey) {
    throw new Error(
      'MASTER_KEY environment variable is not set. ' +
      'Generate with: openssl rand -base64 32'
    );
  }

  // Decode base64 key
  const keyBuffer = Buffer.from(masterKey, 'base64');

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `MASTER_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 8} bits). ` +
      `Got ${keyBuffer.length} bytes. Generate with: openssl rand -base64 32`
    );
  }

  return keyBuffer;
}

/**
 * Encrypt sensitive data using AES-256-GCM.
 *
 * Security features:
 * - Random IV for each encryption (prevents pattern analysis)
 * - Auth tag for integrity verification (prevents tampering)
 *
 * @param plaintext - The data to encrypt
 * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
 *
 * @example
 * const encrypted = encrypt('postgresql://user:pass@host/db');
 * // Returns: "YWJjZGVm...:dGFnMTIz...:ZW5jcnlw..."
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();

  // Generate random IV for each encryption operation
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher with AES-256-GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the plaintext
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  // Get authentication tag (for integrity verification)
  const authTag = cipher.getAuthTag();

  // Combine: iv:authTag:encrypted (all base64 encoded)
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

/**
 * Decrypt data that was encrypted with encrypt().
 *
 * @param encryptedData - String in format: iv:authTag:ciphertext (base64)
 * @returns Decrypted plaintext
 * @throws Error if data is tampered, corrupted, or key is wrong
 *
 * @example
 * const decrypted = decrypt(encryptedString);
 * // Returns: "postgresql://user:pass@host/db"
 */
export function decrypt(encryptedData: string): string {
  const key = getMasterKey();

  // Parse the components
  const parts = encryptedData.split(':');

  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted data format. Expected iv:authTag:ciphertext (base64)'
    );
  }

  const [ivBase64, authTagBase64, ciphertextBase64] = parts;

  // Decode base64 components
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');

  // Validate IV length
  if (iv.length !== IV_LENGTH) {
    throw new Error(
      `Invalid IV length: ${iv.length} bytes, expected ${IV_LENGTH} bytes`
    );
  }

  // Validate auth tag length
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length: ${authTag.length} bytes, expected ${AUTH_TAG_LENGTH} bytes`
    );
  }

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  // Set auth tag for integrity verification
  // This will cause decryption to fail if data was tampered
  decipher.setAuthTag(authTag);

  // Decrypt
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    // GCM will throw if auth tag doesn't match (tampering detected)
    throw new Error(
      'Decryption failed. Data may be corrupted, tampered, or encrypted with a different key.'
    );
  }
}

/**
 * Securely compare two strings in constant time.
 * Prevents timing attacks when comparing sensitive values.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate a new random encryption key.
 * For documentation/setup purposes only.
 *
 * @returns Base64-encoded 32-byte key
 *
 * @example
 * // In Node.js REPL or setup script:
 * console.log(generateKey());
 * // Copy output to MASTER_KEY environment variable
 */
export function generateKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Check if a string appears to be encrypted data.
 * Does not validate the encryption, just checks format.
 *
 * @param data - String to check
 * @returns true if data matches encrypted format
 */
export function isEncrypted(data: string): boolean {
  const parts = data.split(':');
  if (parts.length !== 3) return false;

  try {
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    return iv.length === IV_LENGTH && authTag.length === AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}

/**
 * Safely clear sensitive data from a string variable.
 * Note: This is best-effort in JavaScript due to string immutability.
 * For maximum security, avoid storing decrypted secrets longer than necessary.
 *
 * @param obj - Object with string properties to clear
 */
export function clearSensitiveData(obj: Record<string, unknown>): void {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = '';
    }
  }
}

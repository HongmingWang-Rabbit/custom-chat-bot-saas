# Multi-Tenant Encryption Architecture

## Overview

Each tenant gets a **dedicated Supabase database**. Sensitive credentials (database URLs, API keys) are stored with **AES-256-GCM encryption** in the main database.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Main Database (DATABASE_URL)                            │
│                                                                                 │
│   tenants table:                                                                │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │ slug      │ name       │ encrypted_database_url    │ encrypted_llm_key │  │
│   │───────────│────────────│───────────────────────────│───────────────────│  │
│   │ acme-corp │ Acme Corp  │ iv:tag:encrypted_url...   │ iv:tag:enc_key... │  │
│   │ beta-inc  │ Beta Inc   │ iv:tag:encrypted_url...   │ iv:tag:enc_key... │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│                    decrypt with MASTER_KEY (from env)                           │
│                              │                                                  │
│            ┌─────────────────┼─────────────────┐                               │
│            ▼                 ▼                 ▼                               │
│   ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                     │
│   │  Acme Corp DB  │ │  Beta Inc DB   │ │   Demo Co DB   │                     │
│   │  (dedicated)   │ │  (dedicated)   │ │  (dedicated)   │                     │
│   └────────────────┘ └────────────────┘ └────────────────┘                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## AES-256-GCM Encryption

### Encryption Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Encryption Flow                                     │
│                                                                             │
│   Plaintext                   MASTER_KEY                    Encrypted       │
│   (database_url)              (from env)                    (stored)        │
│        │                          │                             ▲           │
│        ▼                          ▼                             │           │
│   ┌─────────┐    ┌─────────┐   ┌──────────────┐   ┌───────────────────┐    │
│   │  Input  │───►│   IV    │──►│  AES-256-GCM │──►│ iv:authTag:cipher │    │
│   │  Data   │    │ (random)│   │   Encrypt    │   │   (base64)        │    │
│   └─────────┘    └─────────┘   └──────────────┘   └───────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Decryption Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Decryption Flow                                     │
│                                                                             │
│   Encrypted                   MASTER_KEY                    Plaintext       │
│   (from DB)                   (from env)                    (runtime)       │
│        │                          │                             ▲           │
│        ▼                          ▼                             │           │
│   ┌───────────────────┐   ┌──────────────┐   ┌─────────────────────────┐   │
│   │ iv:authTag:cipher │──►│  AES-256-GCM │──►│  Decrypted database_url │   │
│   │   (parse)         │   │   Decrypt    │   │  (used for connection)  │   │
│   └───────────────────┘   └──────────────┘   └─────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Storage Format

Encrypted data is stored as colon-separated base64 values:

```
iv:authTag:encryptedData

Example:
YWJjZGVmZ2hpamtsbW5vcA==:dGFnMTIzNDU2Nzg5MDEyMzQ1Ng==:ZW5jcnlwdGVkZGF0YWhlcmU=
|_________________________|_______________________________|___________________|
         IV (16 bytes)           Auth Tag (16 bytes)         Encrypted Data
        (base64)                    (base64)                   (base64)
```

---

## Implementation

### Crypto Module

**Location:** `src/lib/crypto/encryption.ts`

```typescript
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;          // 128 bits
const AUTH_TAG_LENGTH = 16;    // 128 bits
const KEY_LENGTH = 32;         // 256 bits

export function encrypt(plaintext: string): string {
  const key = getMasterKey();  // from MASTER_KEY env
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

export function decrypt(encryptedData: string): string {
  const key = getMasterKey();
  const [ivB64, tagB64, cipherB64] = encryptedData.split(':');

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}
```

### Tenant Service

**Location:** `src/lib/services/tenant-service.ts`

Key features:
- **Connection pooling** with TTL (5 minutes)
- **Lazy decryption** only when database access needed
- **Pool cleanup** interval to prevent memory leaks

```typescript
export class TenantService {
  // Get tenant without secrets (for public info)
  async getTenant(slug: string): Promise<Tenant | null>

  // Get tenant with decrypted secrets (for DB access)
  async getTenantWithSecrets(slug: string): Promise<TenantWithSecrets | null>

  // Get cached database connection (Drizzle ORM)
  async getTenantDb(slug: string): Promise<TenantDatabase | null>

  // Create tenant with encrypted credentials
  async createTenant(params: CreateTenantParams): Promise<Tenant>

  // Create tenant with auto-provisioned Supabase project
  async createTenantWithProvisioning(params: ProvisionParams): Promise<Tenant>
}
```

---

## Supabase Provisioning

**Location:** `src/lib/supabase/provisioning.ts`

Automatically provisions new Supabase projects for tenants using the Management API.

```typescript
interface ProvisioningResult {
  projectId: string;
  projectRef: string;
  databaseUrl: string;
  anonKey: string;
  serviceKey: string;
  region: string;
}

// Provision a new Supabase project
await provisionSupabaseProject(tenantSlug, {
  region: 'us-east-1',
  organizationId: process.env.SUPABASE_ORG_ID,
});
```

### Provisioning Flow

1. **Create Project** via Supabase Management API
2. **Wait for Ready** status (polling with timeout)
3. **Get API Keys** (anon + service role)
4. **Run Migrations** on new database
5. **Encrypt Credentials** and store in main DB

---

## What Gets Encrypted

| Field | Encrypted | Purpose |
|-------|-----------|---------|
| `encrypted_database_url` | Yes | PostgreSQL connection string |
| `encrypted_service_key` | Yes | Supabase service role key |
| `encrypted_anon_key` | Yes | Supabase anonymous key |
| `encrypted_llm_api_key` | Yes | Tenant's OpenAI/Anthropic key |
| `database_host` | No | Masked display (e.g., `abc.***.supabase.co`) |
| `branding` | No | UI customization (public) |
| `rag_config` | No | RAG settings (not sensitive) |

---

## Security Best Practices

### 1. MASTER_KEY Management

```bash
# Generate a secure key (32 bytes = 256 bits)
openssl rand -base64 32

# Store in environment only (never in code)
MASTER_KEY=your-base64-key-here
```

### 2. Environment Variables

```env
# Main database (tenant metadata)
DATABASE_URL=postgresql://...

# Encryption key (NEVER commit!)
MASTER_KEY=your-32-byte-base64-key

# Supabase provisioning
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_ORG_ID=your-org-id

# Fallback LLM key
OPENAI_API_KEY=sk-...
```

### 3. Key Rotation

When rotating MASTER_KEY:
1. Deploy new key alongside old key temporarily
2. Re-encrypt all tenant secrets with new key
3. Remove old key from environment
4. Clear connection pool

### 4. Connection Pool Security

- **TTL**: Connections expire after 5 minutes
- **Max size**: 100 connections (LRU eviction)
- **Cleanup**: Automatic cleanup every 60 seconds
- **Invalidation**: Pool cleared on credential update

---

## Request Flow with Encryption

```
┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Client  │    │  API Route  │    │   Tenant    │    │   Tenant    │
│          │    │             │    │   Service   │    │   Database  │
└────┬─────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
     │                 │                   │                  │
     │ POST /api/qa    │                   │                  │
     │ {tenantSlug}    │                   │                  │
     │────────────────►│                   │                  │
     │                 │                   │                  │
     │                 │  getTenantDb()    │                  │
     │                 │──────────────────►│                  │
     │                 │                   │                  │
     │                 │                   │ Check pool       │
     │                 │                   │ (cache miss)     │
     │                 │                   │                  │
     │                 │                   │ Query main DB    │
     │                 │                   │ for tenant       │
     │                 │                   │                  │
     │                 │                   │ Decrypt with     │
     │                 │                   │ MASTER_KEY       │
     │                 │                   │                  │
     │                 │                   │ Create Drizzle   │
     │                 │                   │ client           │
     │                 │                   │                  │
     │                 │                   │ Add to pool      │
     │                 │                   │                  │
     │                 │◄──────────────────│                  │
     │                 │  TenantDatabase   │                  │
     │                 │                   │                  │
     │                 │  Query tenant DB  │                  │
     │                 │─────────────────────────────────────►│
     │                 │◄─────────────────────────────────────│
     │                 │  [documents]      │                  │
     │                 │                   │                  │
     │◄────────────────│                   │                  │
     │  Response       │                   │                  │
```

---

## Testing Encryption

```typescript
import { encrypt, decrypt, generateKey } from '@/lib/crypto/encryption';

describe('Encryption', () => {
  beforeAll(() => {
    process.env.MASTER_KEY = generateKey();
  });

  it('encrypts and decrypts correctly', () => {
    const plaintext = 'postgresql://user:pass@host:5432/db';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'test-data';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('fails with tampered data (auth tag verification)', () => {
    const encrypted = encrypt('secret');
    const tampered = encrypted.replace('a', 'b');
    expect(() => decrypt(tampered)).toThrow();
  });
});
```

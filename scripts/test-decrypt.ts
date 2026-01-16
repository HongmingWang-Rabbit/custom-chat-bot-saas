import postgres from 'postgres';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function decrypt(encrypted: string): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) throw new Error('MASTER_KEY not set');

  const key = Buffer.from(masterKey, 'base64');
  console.log('Key length:', key.length, '(should be 32)');

  const parts = encrypted.split(':');
  console.log('Parts count:', parts.length, '(should be 3)');

  if (parts.length !== 3) throw new Error('Invalid format');

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  console.log('IV length:', iv.length, '(should be 16)');
  console.log('AuthTag length:', authTag.length, '(should be 16)');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

async function check() {
  const sql = postgres(process.env.DATABASE_URL!);

  const tenants = await sql`SELECT slug, encrypted_database_url FROM tenants WHERE slug = 'test-tenant-003'`;

  if (tenants.length === 0) {
    console.log('Tenant not found');
    await sql.end();
    return;
  }

  console.log('Found tenant:', tenants[0].slug);

  try {
    const decrypted = decrypt(tenants[0].encrypted_database_url);
    console.log('Decryption SUCCESS');
    console.log('Decrypted URL (partial):', decrypted.substring(0, 40) + '...');
  } catch (e: any) {
    console.log('Decryption FAILED:', e.message);
  }

  await sql.end();
}

check();

import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * The active schema stores these values in scalar BYTEA columns. The old
 * client helper called pgcrypto functions through the public client and
 * treated BYTEA as an array, so it could neither protect the key nor reliably
 * round-trip a value. The migration does not define a callable pgcrypto RPC
 * wrapper. Until one is added, this module uses a versioned AES-256-GCM
 * envelope serialized to PostgreSQL's BYTEA hex input format.
 *
 * The envelope format is deterministic (version/algorithm/field payload
 * contract), but each value gets a fresh nonce. This avoids nonce reuse while
 * keeping the storage contract stable. ENCRYPTION_KEY is read only here, on
 * the server; it must never be imported by a client component. Limitation:
 * BYTEA values written by the legacy client/RPC helper are intentionally not
 * guessed at or returned; those records need an explicit migration before
 * they can be read by this codec.
 */

const ENCRYPTION_KEY_ENV = 'ENCRYPTION_KEY';
const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;

export interface EmergencyContacts {
  primary_name: string;
  primary_phone: string;
  secondary_name: string;
  secondary_phone: string;
}

type SensitiveEnvelope = {
  v: typeof ENVELOPE_VERSION;
  alg: typeof ENVELOPE_ALGORITHM;
  iv: string;
  tag: string;
  data: string;
};

function getEncryptionKey(): Buffer {
  const configured = process.env[ENCRYPTION_KEY_ENV];
  if (!configured || Buffer.byteLength(configured, 'utf8') < 32 || configured === 'your-encryption-key-here-change-in-production') {
    throw new Error('Sensitive field encryption is not configured.');
  }

  // Hashing gives AES a fixed-size key without exposing or persisting the
  // configured secret. The secret itself is never returned to an action.
  return createHash('sha256').update(configured, 'utf8').digest();
}

/** Fail closed for reads as well as writes when the server key is absent. */
export function assertTravelerEncryptionConfigured(): void {
  getEncryptionKey();
}

function toByteaHex(value: Buffer): string {
  return `\\x${value.toString('hex')}`;
}

function fromBytea(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value && typeof value === 'object' && 'type' in value && 'data' in value) {
    const candidate = value as { type?: unknown; data?: unknown };
    if (candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
      return Buffer.from(candidate.data.filter((item): item is number => typeof item === 'number'));
    }
  }

  if (typeof value !== 'string') {
    return null;
  }

  if (value.startsWith('\\x')) {
    const hex = value.slice(2);
    if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
      return null;
    }
    return Buffer.from(hex, 'hex');
  }

  // This is only a compatibility read path for drivers that expose BYTEA as
  // base64. New writes always use PostgreSQL hex BYTEA input.
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return null;
  }
}

function parseEnvelope(value: unknown): SensitiveEnvelope | null {
  const bytes = fromBytea(value);
  if (!bytes) return null;

  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as Partial<SensitiveEnvelope>;
    if (
      parsed.v !== ENVELOPE_VERSION ||
      parsed.alg !== ENVELOPE_ALGORITHM ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.tag !== 'string' ||
      typeof parsed.data !== 'string'
    ) {
      return null;
    }
    return parsed as SensitiveEnvelope;
  } catch {
    return null;
  }
}

function encryptValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ENVELOPE_ALGORITHM, getEncryptionKey(), nonce);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: SensitiveEnvelope = {
    v: ENVELOPE_VERSION,
    alg: ENVELOPE_ALGORITHM,
    iv: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  };

  return toByteaHex(Buffer.from(JSON.stringify(envelope), 'utf8'));
}

function decryptValue<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  const envelope = parseEnvelope(value);
  if (!envelope) {
    throw new Error('Unable to decrypt sensitive traveler data.');
  }

  try {
    const nonce = Buffer.from(envelope.iv, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const encrypted = Buffer.from(envelope.data, 'base64url');
    if (nonce.length !== NONCE_BYTES || tag.length !== 16) throw new Error('Invalid encrypted payload.');

    const decipher = createDecipheriv(ENVELOPE_ALGORITHM, getEncryptionKey(), nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw new Error('Unable to decrypt sensitive traveler data.');
  }
}

export function encryptTravelerMedicalConditions(value: string[] | null): string | null {
  return encryptValue(value);
}

export function decryptTravelerMedicalConditions(value: unknown): string[] {
  const decrypted = decryptValue<unknown>(value);
  if (decrypted === null) return [];
  if (!Array.isArray(decrypted) || !decrypted.every((item) => typeof item === 'string')) throw new Error('Invalid sensitive field shape.');
  return decrypted;
}

export function encryptTravelerAccessibilityNeeds(value: string[] | null): string | null {
  return encryptValue(value);
}

export function decryptTravelerAccessibilityNeeds(value: unknown): string[] {
  const decrypted = decryptValue<unknown>(value);
  if (decrypted === null) return [];
  if (!Array.isArray(decrypted) || !decrypted.every((item) => typeof item === 'string')) throw new Error('Invalid sensitive field shape.');
  return decrypted;
}

export function encryptTravelerEmergencyContacts(value: EmergencyContacts | null): string | null {
  return encryptValue(value);
}

export function decryptTravelerEmergencyContacts(value: unknown): EmergencyContacts | null {
  const decrypted = decryptValue<unknown>(value);
  if (decrypted === null) return null;
  if (!decrypted || typeof decrypted !== 'object' || Array.isArray(decrypted)) throw new Error('Invalid sensitive field shape.');

  const candidate = decrypted as Record<string, unknown>;
  const fields = ['primary_name', 'primary_phone', 'secondary_name', 'secondary_phone'] as const;
  if (!fields.every((field) => typeof candidate[field] === 'string')) throw new Error('Invalid sensitive field shape.');

  return {
    primary_name: candidate.primary_name as string,
    primary_phone: candidate.primary_phone as string,
    secondary_name: candidate.secondary_name as string,
    secondary_phone: candidate.secondary_phone as string,
  };
}

/** Generic server-only codec for notification BYTEA payloads. */
export function encryptServerJSON(value: unknown): string | null {
  try {
    return encryptValue(value);
  } catch {
    // Notifications remain usable when optional payload encryption is not configured.
    return null;
  }
}

/** Generic server-only decoder for notification BYTEA payloads. */
export function decryptServerJSON(value: unknown): unknown | null {
  try {
    return decryptValue<unknown>(value);
  } catch {
    return null;
  }
}

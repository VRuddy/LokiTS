// Replaces loki-crypted-file-adapter.js from LokiJS, MIT. Original author: Hans Klunder.
import { callAdapter } from '../persistence/adapter-bridge';
import { withAdapterCallback } from '../persistence/callbacks';
import type { AnyLokiAdapter } from '../types/adapter';

export interface LokiEncryptedAdapterOptions {
  secret: string;
  /** PBKDF2 iterations for new keys (default: 600 000). */
  iterations?: number;
}

interface Envelope {
  format: 'loki-encrypted';
  version: 1;
  cipher: 'aes-256-gcm';
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
  iv: string;
  value: string;
}

/** Format of loki-crypted-file-adapter.js: AES-256-CBC, PBKDF2-SHA1, no authentication. */
interface LegacyEnvelope {
  cipher: 'aes-256-cbc';
  keyLength: number;
  iterations: number;
  salt: string;
  iv: string;
  value: string;
}

interface CachedKey {
  salt: string;
  iterations: number;
  key: CryptoKey;
}

const DEFAULT_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

function toBase64(bytes: Uint8Array): string {
  const nodeBuffer = (globalThis as { Buffer?: any }).Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(bytes).toString('base64');
  }
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const nodeBuffer = (globalThis as { Buffer?: any }).Buffer;
  if (nodeBuffer) {
    return new Uint8Array(nodeBuffer.from(text, 'base64'));
  }
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function deriveKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  hash: 'SHA-256' | 'SHA-1',
  algorithm: { name: 'AES-GCM' | 'AES-CBC'; length: number },
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey({ name: 'PBKDF2', hash, salt, iterations }, base, algorithm, false, [
    'encrypt',
    'decrypt',
  ]);
}

function parseEnvelope(stored: string): Envelope | LegacyEnvelope {
  let parsed: any;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error('LokiEncryptedAdapter: the stored data is not encrypted by Loki');
  }
  if (
    parsed?.format === 'loki-encrypted' &&
    parsed.version === 1 &&
    parsed.cipher === 'aes-256-gcm'
  ) {
    return parsed as Envelope;
  }
  if (
    parsed?.cipher === 'aes-256-cbc' &&
    parsed.version === undefined &&
    parsed.salt &&
    parsed.iv &&
    parsed.value
  ) {
    return parsed as LegacyEnvelope;
  }
  throw new Error('LokiEncryptedAdapter: the stored data is not encrypted by Loki');
}

/** Encrypts what another adapter stores (AES-256-GCM, key derived from a secret with PBKDF2-SHA256). */
export class LokiEncryptedAdapter {
  declare inner: AnyLokiAdapter;
  declare secret: string;
  declare iterations: number;
  declare cachedKey: CachedKey | undefined;

  constructor(inner: AnyLokiAdapter, options: LokiEncryptedAdapterOptions) {
    if (!inner) {
      throw new Error('LokiEncryptedAdapter requires an adapter to wrap');
    }
    if (!options?.secret) {
      throw new Error('LokiEncryptedAdapter requires a secret');
    }
    this.inner = inner;
    this.secret = options.secret;
    this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
    this.cachedKey = undefined;
  }

  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<string | null> {
    return withAdapterCallback(this.load(dbname), callback, 'load') as Promise<string | null>;
  }

  saveDatabase(dbname: string, data: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(this.save(dbname, data), callback, 'write') as Promise<void>;
  }

  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    const deleting = callAdapter(this.inner, 'deleteDatabase', [dbname], 'write') as Promise<void>;
    return withAdapterCallback(deleting, callback, 'write') as Promise<void>;
  }

  private async load(dbname: string): Promise<string | null> {
    const stored = await callAdapter(this.inner, 'loadDatabase', [dbname], 'load');
    if (stored === null || stored === undefined) {
      return null;
    }
    if (typeof stored !== 'string') {
      throw new Error('LokiEncryptedAdapter: unexpected value from the wrapped adapter');
    }
    const envelope = parseEnvelope(stored);
    try {
      if (envelope.cipher === 'aes-256-cbc') {
        const key = await deriveKey(
          this.secret,
          fromBase64(envelope.salt),
          envelope.iterations,
          'SHA-1',
          {
            name: 'AES-CBC',
            length: envelope.keyLength,
          },
        );
        const plain = await subtle().decrypt(
          { name: 'AES-CBC', iv: fromBase64(envelope.iv) },
          key,
          fromBase64(envelope.value),
        );
        return decoder.decode(plain);
      }
      const key = await this.keyFor(envelope.salt, envelope.iterations);
      const plain = await subtle().decrypt(
        { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
        key,
        fromBase64(envelope.value),
      );
      return decoder.decode(plain);
    } catch (err) {
      throw new Error('LokiEncryptedAdapter: wrong secret or corrupted data', { cause: err });
    }
  }

  private async save(dbname: string, data: string): Promise<void> {
    const { key, salt, iterations } = await this.encryptionKey();
    // a fresh 96-bit IV per save: GCM must never reuse an IV with the same key
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const value = await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(data));
    const envelope: Envelope = {
      format: 'loki-encrypted',
      version: 1,
      cipher: 'aes-256-gcm',
      kdf: 'pbkdf2-sha256',
      iterations,
      salt,
      iv: toBase64(iv),
      value: toBase64(new Uint8Array(value)),
    };
    await callAdapter(this.inner, 'saveDatabase', [dbname, JSON.stringify(envelope)], 'write');
  }

  // PBKDF2 is deliberately slow: derive once per salt and reuse the key for every save
  private async keyFor(salt: string, iterations: number): Promise<CryptoKey> {
    const cached = this.cachedKey;
    if (cached && cached.salt === salt && cached.iterations === iterations) {
      return cached.key;
    }
    const key = await deriveKey(this.secret, fromBase64(salt), iterations, 'SHA-256', {
      name: 'AES-GCM',
      length: 256,
    });
    this.cachedKey = { salt, iterations, key };
    return key;
  }

  private async encryptionKey(): Promise<CachedKey> {
    if (!this.cachedKey) {
      const salt = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
      await this.keyFor(salt, this.iterations);
    }
    return this.cachedKey as CachedKey;
  }
}

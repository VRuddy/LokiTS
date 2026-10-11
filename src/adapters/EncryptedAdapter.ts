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

interface DerivedKey {
  salt: string;
  iterations: number;
  key: CryptoKey;
}

const DEFAULT_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000;
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

function deriveKey(
  base: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  hash: 'SHA-256' | 'SHA-1',
  algorithm: { name: 'AES-GCM' | 'AES-CBC'; length: number },
): Promise<CryptoKey> {
  return subtle().deriveKey({ name: 'PBKDF2', hash, salt, iterations }, base, algorithm, false, [
    'encrypt',
    'decrypt',
  ]);
}

const notEncrypted = () =>
  new Error('LokiEncryptedAdapter: the stored data is not encrypted by Loki');
const invalidEnvelope = (detail: string) =>
  new Error(`LokiEncryptedAdapter: invalid encrypted envelope (${detail})`);
const isIterations = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ITERATIONS;
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

// the parameters come from the file, so they are bounded before any key derivation
function parseEnvelope(stored: string): Envelope | LegacyEnvelope {
  let parsed: any;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw notEncrypted();
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw notEncrypted();
  }
  const legacy =
    parsed.cipher === 'aes-256-cbc' && parsed.format === undefined && parsed.version === undefined;
  if (parsed.format !== 'loki-encrypted' && !legacy) {
    throw notEncrypted();
  }
  if (!legacy) {
    if (parsed.version !== 1) {
      throw new Error('LokiEncryptedAdapter: unsupported encrypted format version');
    }
    if (parsed.cipher !== 'aes-256-gcm' || parsed.kdf !== 'pbkdf2-sha256') {
      throw invalidEnvelope('unsupported cipher or key derivation');
    }
  } else if (![128, 192, 256].includes(parsed.keyLength)) {
    throw invalidEnvelope('unsupported key length');
  }
  if (!isIterations(parsed.iterations)) {
    throw invalidEnvelope(`iterations must be an integer between 1 and ${MAX_ITERATIONS}`);
  }
  if (
    !isNonEmptyString(parsed.salt) ||
    !isNonEmptyString(parsed.iv) ||
    !isNonEmptyString(parsed.value)
  ) {
    throw invalidEnvelope('salt, iv and value must be strings');
  }
  return parsed as Envelope | LegacyEnvelope;
}

/** Encrypts what another adapter stores (AES-256-GCM, key derived from a secret with PBKDF2-SHA256). */
export class LokiEncryptedAdapter {
  // ES private fields: nothing here shows up in JSON.stringify or util.inspect
  readonly #inner: AnyLokiAdapter;
  readonly #iterations: number;
  // the secret is imported once as a non-extractable key; the string itself is not kept
  readonly #base: Promise<CryptoKey>;
  #encryptionKey: Promise<DerivedKey> | undefined;

  constructor(inner: AnyLokiAdapter, options: LokiEncryptedAdapterOptions) {
    if (!inner) {
      throw new Error('LokiEncryptedAdapter requires an adapter to wrap');
    }
    if (!options?.secret) {
      throw new Error('LokiEncryptedAdapter requires a secret');
    }
    const iterations = options.iterations ?? DEFAULT_ITERATIONS;
    if (!isIterations(iterations)) {
      throw new Error(
        `LokiEncryptedAdapter iterations must be an integer between 1 and ${MAX_ITERATIONS}`,
      );
    }
    this.#inner = inner;
    this.#iterations = iterations;
    this.#base = Promise.resolve().then(() =>
      subtle().importKey('raw', encoder.encode(options.secret), 'PBKDF2', false, ['deriveKey']),
    );
    // a failure surfaces on first use; this keeps it from being reported as unhandled before then
    this.#base.catch(() => undefined);
  }

  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<string | null> {
    return withAdapterCallback(this.#load(dbname), callback, 'load') as Promise<string | null>;
  }

  saveDatabase(dbname: string, data: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(this.#save(dbname, data), callback, 'write') as Promise<void>;
  }

  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    const deleting = callAdapter(this.#inner, 'deleteDatabase', [dbname], 'write') as Promise<void>;
    return withAdapterCallback(deleting, callback, 'write') as Promise<void>;
  }

  async #load(dbname: string): Promise<string | null> {
    const stored = await callAdapter(this.#inner, 'loadDatabase', [dbname], 'load');
    if (stored === null || stored === undefined) {
      return null;
    }
    if (typeof stored !== 'string') {
      throw new Error('LokiEncryptedAdapter: unexpected value from the wrapped adapter');
    }
    const envelope = parseEnvelope(stored);
    try {
      const base = await this.#base;
      if (envelope.cipher === 'aes-256-cbc') {
        const key = await deriveKey(base, fromBase64(envelope.salt), envelope.iterations, 'SHA-1', {
          name: 'AES-CBC',
          length: envelope.keyLength,
        });
        const plain = await subtle().decrypt(
          { name: 'AES-CBC', iv: fromBase64(envelope.iv) },
          key,
          fromBase64(envelope.value),
        );
        return decoder.decode(plain);
      }
      const cached = await this.#encryptionKey?.catch(() => undefined);
      const reusable = cached?.salt === envelope.salt && cached.iterations === envelope.iterations;
      const key = reusable
        ? cached.key
        : await deriveKey(base, fromBase64(envelope.salt), envelope.iterations, 'SHA-256', {
            name: 'AES-GCM',
            length: 256,
          });
      const plain = await subtle().decrypt(
        { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
        key,
        fromBase64(envelope.value),
      );
      // the file's key parameters are adopted only once they authenticated, and never below the configured cost
      if (!reusable && envelope.iterations >= this.#iterations) {
        this.#encryptionKey = Promise.resolve({
          salt: envelope.salt,
          iterations: envelope.iterations,
          key,
        });
      }
      return decoder.decode(plain);
    } catch (err) {
      throw new Error('LokiEncryptedAdapter: wrong secret or corrupted data', { cause: err });
    }
  }

  async #save(dbname: string, data: string): Promise<void> {
    const { key, salt, iterations } = await this.#currentKey();
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
    await callAdapter(this.#inner, 'saveDatabase', [dbname, JSON.stringify(envelope)], 'write');
  }

  // PBKDF2 is deliberately slow: derive once (concurrent first saves share the promise) and reuse the key
  #currentKey(): Promise<DerivedKey> {
    if (!this.#encryptionKey) {
      const salt = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
      const deriving = this.#base
        .then((base) =>
          deriveKey(base, fromBase64(salt), this.#iterations, 'SHA-256', {
            name: 'AES-GCM',
            length: 256,
          }),
        )
        .then((key) => ({ salt, iterations: this.#iterations, key }));
      this.#encryptionKey = deriving;
      deriving.catch(() => {
        if (this.#encryptionKey === deriving) {
          this.#encryptionKey = undefined;
        }
      });
    }
    return this.#encryptionKey;
  }
}

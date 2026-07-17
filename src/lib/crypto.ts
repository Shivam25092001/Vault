/**
 * Crypto core — HLD §5, §6.
 *
 * Pure and I/O-free: no network, no storage, no DOM. Everything here is
 * native WebCrypto, so it runs identically in the browser and under Node's
 * test runner.
 */

export const KDF_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BITS = 128;
export const TAG_BYTES = TAG_BITS / 8;
export const KEY_BITS = 256;
export const VAULT_ID_BYTES = 16;

/**
 * Our byte arrays are always backed by a plain ArrayBuffer (never a
 * SharedArrayBuffer). Saying so lets WebCrypto's BufferSource-typed APIs
 * accept them directly under TS 5.7+'s generic typed arrays — no casts.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Header framed *inside* the ciphertext, so filenames/types stay secret. */
export interface PhotoHeader {
  name: string;
  type: string;
}

/** manifest.json — public, plaintext. Carries no code material. */
export interface Manifest {
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iter: number };
  salt: string;
  items: { enc: string }[];
}

/**
 * A GCM authentication failure. Per HLD §5 this *is* the wrong-code signal —
 * there is no separate verifier to attack. It can also mean corrupt bytes,
 * which is indistinguishable by construction and treated the same.
 */
export class WrongCodeError extends Error {
  constructor() {
    super('Wrong code');
    this.name = 'WrongCodeError';
  }
}

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 16 random bytes, base64url. Unguessable — acts as a capability URL (HLD §4). */
export function newVaultId(): string {
  return toBase64(randomBytes(VAULT_ID_BYTES))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Storage object name for the nth photo: 001.enc, 002.enc, … */
export function encName(index: number): string {
  return `${String(index + 1).padStart(3, '0')}.enc`;
}

/**
 * PBKDF2-HMAC-SHA-256 → AES-GCM-256 key.
 *
 * Marked non-extractable: the key cannot be read back out of WebCrypto, so it
 * can't leak through a stray console.log or a serialized error.
 */
export async function deriveKey(
  code: string,
  salt: Bytes,
  iterations: number = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** headerLen (4B BE u32) ‖ header JSON (UTF-8) ‖ raw photo bytes */
export function frame(header: PhotoHeader, bytes: Uint8Array): Bytes {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.length + bytes.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, 4);
  out.set(bytes, 4 + headerBytes.length);
  return out;
}

export function unframe(framed: Uint8Array): { header: PhotoHeader; bytes: Uint8Array } {
  if (framed.length < 4) throw new Error('Truncated payload: no header length');
  const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  const headerLen = view.getUint32(0, false);
  if (4 + headerLen > framed.length) throw new Error('Truncated payload: header overruns buffer');
  const header = JSON.parse(
    new TextDecoder().decode(framed.subarray(4, 4 + headerLen)),
  ) as PhotoHeader;
  return { header, bytes: framed.subarray(4 + headerLen) };
}

/** .enc layout: IV (12B) ‖ AES-GCM ciphertext ‖ tag (16B) */
export async function encryptPhoto(
  key: CryptoKey,
  header: PhotoHeader,
  bytes: Uint8Array,
): Promise<Bytes> {
  const iv = randomBytes(IV_BYTES);
  const framed = frame(header, bytes);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_BITS }, key, framed),
  );
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

export async function decryptPhoto(
  key: CryptoKey,
  enc: Bytes,
): Promise<{ header: PhotoHeader; bytes: Uint8Array }> {
  if (enc.length < IV_BYTES + TAG_BYTES) throw new WrongCodeError();
  const iv = enc.subarray(0, IV_BYTES);
  const ct = enc.subarray(IV_BYTES);
  let framed: Uint8Array;
  try {
    framed = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_BITS }, key, ct),
    );
  } catch {
    throw new WrongCodeError();
  }
  return unframe(framed);
}

export function buildManifest(salt: Uint8Array, count: number, iterations = KDF_ITERATIONS): Manifest {
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: iterations },
    salt: toBase64(salt),
    items: Array.from({ length: count }, (_, i) => ({ enc: encName(i) })),
  };
}

/**
 * Validate an untrusted manifest fetched over the network.
 *
 * HLD §4: the manifest is unsigned and its integrity rests on TLS. Tampering
 * gains an attacker nothing (they still need the code), but a malformed one
 * shouldn't crash the viewer — and `iter` is clamped so a hostile manifest
 * can't wedge the tab with a 10-billion-iteration KDF.
 */
export function parseManifest(raw: unknown): Manifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('Manifest is not an object');
  const m = raw as Record<string, unknown>;
  if (m.v !== 1) throw new Error(`Unsupported manifest version: ${String(m.v)}`);

  const kdf = m.kdf as Record<string, unknown> | undefined;
  if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    throw new Error('Unsupported KDF');
  }
  const iter = kdf.iter;
  if (typeof iter !== 'number' || !Number.isInteger(iter) || iter < 1 || iter > 5_000_000) {
    throw new Error('Manifest KDF iterations out of range');
  }

  if (typeof m.salt !== 'string') throw new Error('Manifest salt missing');
  if (fromBase64(m.salt).length !== SALT_BYTES) throw new Error('Manifest salt is the wrong size');

  if (!Array.isArray(m.items)) throw new Error('Manifest items missing');
  const items = m.items.map((it) => {
    const enc = (it as Record<string, unknown> | null)?.enc;
    // Object names are generated, never user-supplied. Enforcing the shape
    // stops a tampered manifest from steering fetches to arbitrary paths.
    if (typeof enc !== 'string' || !/^\d{3}\.enc$/.test(enc)) {
      throw new Error('Manifest item has an invalid name');
    }
    return { enc };
  });

  return { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iter }, salt: m.salt, items };
}

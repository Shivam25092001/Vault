import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  encryptPhoto,
  decryptPhoto,
  frame,
  unframe,
  buildManifest,
  parseManifest,
  randomBytes,
  toBase64,
  fromBase64,
  newVaultId,
  encName,
  WrongCodeError,
  IV_BYTES,
  TAG_BYTES,
  SALT_BYTES,
  KDF_ITERATIONS,
} from './crypto';

// The real KDF runs at 600k iterations (HLD §5). That cost is the point in
// production and pure waste in a test, so these run reduced — except where a
// test is specifically about the parameter.
const FAST = 1_000;

const HEADER = { name: 'IMG_0421.HEIC', type: 'image/heic' };

/** Every byte value 0–255, so a round trip can't hide an encoding bug. */
function allBytePatterns(): Uint8Array {
  return new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
}

/**
 * Filler for size-oriented tests. Deliberately not randomBytes():
 * getRandomValues() refuses more than 65,536 bytes per call, and production
 * never asks it for more than a 16-byte salt.
 */
function pseudoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** Byte-exact equality without depending on Node's Buffer type. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Interpret bytes as latin1 so any embedded ASCII (filenames) would show. */
function asLatin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe('framing', () => {
  it('round-trips header and body', () => {
    const body = allBytePatterns();
    const { header, bytes } = unframe(frame(HEADER, body));
    expect(header).toEqual(HEADER);
    expect(Array.from(bytes)).toEqual(Array.from(body));
  });

  it('handles an empty body', () => {
    const { header, bytes } = unframe(frame(HEADER, new Uint8Array(0)));
    expect(header).toEqual(HEADER);
    expect(bytes.length).toBe(0);
  });

  it('survives non-ASCII filenames', () => {
    const h = { name: 'ॐ-日本-🌸.jpg', type: 'image/jpeg' };
    expect(unframe(frame(h, new Uint8Array([1, 2, 3]))).header).toEqual(h);
  });

  it('rejects a truncated payload rather than reading past the end', () => {
    const framed = frame(HEADER, new Uint8Array([1, 2, 3]));
    expect(() => unframe(framed.subarray(0, 2))).toThrow(/truncated/i);
    expect(() => unframe(framed.subarray(0, 6))).toThrow(/truncated/i);
  });
});

describe('key derivation', () => {
  it('is deterministic for the same code and salt', async () => {
    const salt = randomBytes(SALT_BYTES);
    const a = await deriveKey('open sesame', salt, FAST);
    const b = await deriveKey('open sesame', salt, FAST);
    const blob = await encryptPhoto(a, HEADER, new Uint8Array([9, 9, 9]));
    // Proves both derivations produced the same key material.
    await expect(decryptPhoto(b, blob)).resolves.toBeDefined();
  });

  it('produces a non-extractable key', async () => {
    const key = await deriveKey('code', randomBytes(SALT_BYTES), FAST);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('defaults to the iteration count the HLD specifies', () => {
    expect(KDF_ITERATIONS).toBe(600_000);
  });
});

describe('encrypt → decrypt', () => {
  it('returns bytes identical to the original', async () => {
    const key = await deriveKey('trip', randomBytes(SALT_BYTES), FAST);
    const original = allBytePatterns();
    const { header, bytes } = await decryptPhoto(key, await encryptPhoto(key, HEADER, original));
    expect(header).toEqual(HEADER);
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });

  it('round-trips a large-ish photo unchanged', async () => {
    const key = await deriveKey('trip', randomBytes(SALT_BYTES), FAST);
    const original = pseudoRandomBytes(512 * 1024);
    const { bytes } = await decryptPhoto(key, await encryptPhoto(key, HEADER, original));
    expect(sameBytes(bytes, original)).toBe(true);
  });

  it('lays the blob out as IV ‖ ciphertext ‖ tag', async () => {
    const key = await deriveKey('layout', randomBytes(SALT_BYTES), FAST);
    const body = new Uint8Array(100);
    const framedLen = frame(HEADER, body).length;
    const blob = await encryptPhoto(key, HEADER, body);
    expect(blob.length).toBe(IV_BYTES + framedLen + TAG_BYTES);
  });

  it('never reuses an IV across files under the same key', async () => {
    const key = await deriveKey('iv', randomBytes(SALT_BYTES), FAST);
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const blob = await encryptPhoto(key, HEADER, new Uint8Array([1]));
      ivs.add(toBase64(blob.subarray(0, IV_BYTES)));
    }
    expect(ivs.size).toBe(50);
  });

  it('produces different ciphertext for identical input', async () => {
    const key = await deriveKey('dup', randomBytes(SALT_BYTES), FAST);
    const body = new Uint8Array([7, 7, 7]);
    const a = await encryptPhoto(key, HEADER, body);
    const b = await encryptPhoto(key, HEADER, body);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });

  it('hides the filename and MIME type inside the ciphertext', async () => {
    const key = await deriveKey('secret', randomBytes(SALT_BYTES), FAST);
    const blob = await encryptPhoto(key, HEADER, new Uint8Array([1, 2, 3]));
    const asText = asLatin1(blob);
    expect(asText).not.toContain('IMG_0421');
    expect(asText).not.toContain('image/heic');
  });
});

describe('wrong code fails closed', () => {
  it('throws WrongCodeError and reveals nothing', async () => {
    const salt = randomBytes(SALT_BYTES);
    const right = await deriveKey('correct horse', salt, FAST);
    const wrong = await deriveKey('correct hors', salt, FAST);
    const blob = await encryptPhoto(right, HEADER, allBytePatterns());
    await expect(decryptPhoto(wrong, blob)).rejects.toThrow(WrongCodeError);
  });

  it('fails when the salt differs, even with the right code', async () => {
    const right = await deriveKey('same code', randomBytes(SALT_BYTES), FAST);
    const other = await deriveKey('same code', randomBytes(SALT_BYTES), FAST);
    const blob = await encryptPhoto(right, HEADER, new Uint8Array([1]));
    await expect(decryptPhoto(other, blob)).rejects.toThrow(WrongCodeError);
  });

  it('rejects tampered ciphertext', async () => {
    const key = await deriveKey('tamper', randomBytes(SALT_BYTES), FAST);
    const blob = await encryptPhoto(key, HEADER, new Uint8Array([1, 2, 3, 4]));
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    await expect(decryptPhoto(key, blob)).rejects.toThrow(WrongCodeError);
  });

  it('rejects a tampered IV', async () => {
    const key = await deriveKey('tamper-iv', randomBytes(SALT_BYTES), FAST);
    const blob = await encryptPhoto(key, HEADER, new Uint8Array([1, 2, 3, 4]));
    blob[0] = blob[0]! ^ 0xff;
    await expect(decryptPhoto(key, blob)).rejects.toThrow(WrongCodeError);
  });

  it('rejects a runt blob without throwing something unexpected', async () => {
    const key = await deriveKey('runt', randomBytes(SALT_BYTES), FAST);
    await expect(decryptPhoto(key, new Uint8Array(5))).rejects.toThrow(WrongCodeError);
  });
});

describe('base64 and ids', () => {
  it('round-trips every byte value', () => {
    const b = allBytePatterns();
    expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
  });

  it('mints unguessable, url-safe vault ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newVaultId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('names objects in order', () => {
    expect(encName(0)).toBe('001.enc');
    expect(encName(41)).toBe('042.enc');
  });
});

describe('manifest', () => {
  it('carries only what the HLD allows', () => {
    const m = buildManifest(randomBytes(SALT_BYTES), 2);
    expect(Object.keys(m).sort()).toEqual(['items', 'kdf', 'salt', 'v']);
    expect(m.items).toEqual([{ enc: '001.enc' }, { enc: '002.enc' }]);
  });

  it('leaks no photo filenames, types, or code material', () => {
    // The manifest is built from the salt and a count alone — it is never
    // shown a photo or the code, so this asserts the shape stays that way.
    const json = JSON.stringify(buildManifest(randomBytes(SALT_BYTES), 2));
    expect(json).not.toContain('IMG_0421');
    expect(json).not.toContain('image/');
    expect(json).not.toContain('.jpg');
    expect(json).not.toContain('.heic');
    // Every key present is one HLD §6 explicitly permits.
    const keys = new Set<string>();
    JSON.parse(json, function collect(k: string) {
      if (k) keys.add(k);
      // eslint-disable-next-line prefer-rest-params
      return arguments[1] as unknown;
    });
    expect([...keys].sort()).toEqual(['0', '1', 'enc', 'hash', 'items', 'iter', 'kdf', 'name', 'salt', 'v']);
  });

  it('round-trips through parse', () => {
    const m = buildManifest(randomBytes(SALT_BYTES), 3);
    expect(parseManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('rejects malformed or hostile manifests', () => {
    const ok = buildManifest(randomBytes(SALT_BYTES), 1);
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest({ ...ok, v: 2 })).toThrow(/version/i);
    expect(() => parseManifest({ ...ok, kdf: { ...ok.kdf, name: 'scrypt' } })).toThrow(/KDF/i);
    expect(() => parseManifest({ ...ok, salt: toBase64(randomBytes(8)) })).toThrow(/salt/i);
    expect(() => parseManifest({ ...ok, items: [{ enc: '../../etc/passwd' }] })).toThrow(/invalid/i);
    expect(() => parseManifest({ ...ok, items: [{ enc: 'https://evil.test/x' }] })).toThrow(/invalid/i);
  });

  it('clamps iterations so a hostile manifest cannot wedge the tab', () => {
    const ok = buildManifest(randomBytes(SALT_BYTES), 1);
    expect(() => parseManifest({ ...ok, kdf: { ...ok.kdf, iter: 10_000_000_000 } })).toThrow(/range/i);
    expect(() => parseManifest({ ...ok, kdf: { ...ok.kdf, iter: 0 } })).toThrow(/range/i);
  });
});

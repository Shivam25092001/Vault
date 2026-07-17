import { describe, it, expect } from 'vitest';
import { encryptVault, makeDecryptor } from './vault';
import { WrongCodeError } from './crypto';

// Covers the orchestration layer (vault.ts) end-to-end against real File
// objects — the path Encrypt.tsx and Viewer.tsx drive, minus the network.
// The cloud helpers (uploadVault/fetchManifest/fetchBlob) need Supabase and
// are exercised by the manual smoke test in SETUP.md, not here.

const CODE = 'correct horse battery staple';

function patterned(len: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * seed + 3) & 0xff;
  return out;
}

describe('vault round trip', () => {
  it('encrypts a File[] and decrypts byte-identical with metadata intact', async () => {
    const a = patterned(4096, 7);
    const b = patterned(1024, 251);
    const files = [
      new File([a], 'alpha.jpg', { type: 'image/jpeg' }),
      new File([b], 'beta.png', { type: 'image/png' }),
    ];

    const vault = await encryptVault(files, CODE);
    expect(vault.blobs).toHaveLength(2);
    expect(vault.manifest.items).toEqual([{ enc: '001.enc' }, { enc: '002.enc' }]);
    expect(vault.vaultId).toMatch(/^[A-Za-z0-9_-]+$/);

    const decrypt = await makeDecryptor(vault.manifest, CODE);
    const originals = [a, b];
    const names = ['alpha.jpg', 'beta.png'];
    const types = ['image/jpeg', 'image/png'];

    for (let i = 0; i < vault.blobs.length; i++) {
      const { header, blob } = await decrypt(vault.blobs[i]!.bytes);
      expect(header.name).toBe(names[i]);
      expect(header.type).toBe(types[i]);
      const out = new Uint8Array(await blob.arrayBuffer());
      expect(Array.from(out)).toEqual(Array.from(originals[i]!));
    }
  });

  it('preserves a file with an empty MIME type', async () => {
    const bytes = patterned(300, 11);
    const vault = await encryptVault([new File([bytes], 'no-type.bin')], CODE);
    const decrypt = await makeDecryptor(vault.manifest, CODE);
    const { header } = await decrypt(vault.blobs[0]!.bytes);
    // File with no type comes through as the octet-stream fallback, not "".
    expect(header.type).toBe('application/octet-stream');
    expect(header.name).toBe('no-type.bin');
  });

  it('fails closed on a wrong code', async () => {
    const vault = await encryptVault([new File([patterned(512, 5)], 'x.jpg', { type: 'image/jpeg' })], CODE);
    const wrong = await makeDecryptor(vault.manifest, 'not the code');
    await expect(wrong(vault.blobs[0]!.bytes)).rejects.toThrow(WrongCodeError);
  });

  it('uses a distinct IV per file within one vault', async () => {
    const vault = await encryptVault(
      [
        new File([patterned(100, 3)], 'a.jpg', { type: 'image/jpeg' }),
        new File([patterned(100, 3)], 'b.jpg', { type: 'image/jpeg' }),
      ],
      CODE,
    );
    const iv0 = vault.blobs[0]!.bytes.subarray(0, 12);
    const iv1 = vault.blobs[1]!.bytes.subarray(0, 12);
    expect(Array.from(iv0)).not.toEqual(Array.from(iv1));
  });
});

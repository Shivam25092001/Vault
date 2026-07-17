/**
 * Vault orchestration — glues the pure crypto core (crypto.ts) to real files
 * and to storage. Kept separate so the core stays I/O-free and testable.
 */
import {
  deriveKey,
  encryptPhoto,
  decryptPhoto,
  buildManifest,
  parseManifest,
  randomBytes,
  newVaultId,
  encName,
  fromBase64,
  SALT_BYTES,
  type Manifest,
  type PhotoHeader,
  type Bytes,
} from './crypto';
import { supabase, publicUrl, BUCKET } from './supabase';

export interface EncryptedBlob {
  name: string; // e.g. "001.enc"
  bytes: Bytes;
}

export interface EncryptedVault {
  vaultId: string;
  manifest: Manifest;
  blobs: EncryptedBlob[];
}

export interface EncryptProgress {
  done: number;
  total: number;
}

/**
 * Encrypt a set of photos under one code. One salt and one derived key for the
 * whole vault (HLD §5); a fresh IV per file lives inside encryptPhoto.
 */
export async function encryptVault(
  files: File[],
  code: string,
  onProgress?: (p: EncryptProgress) => void,
): Promise<EncryptedVault> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(code, salt);
  const blobs: EncryptedBlob[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const header: PhotoHeader = { name: file.name, type: file.type || 'application/octet-stream' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    blobs.push({ name: encName(i), bytes: await encryptPhoto(key, header, bytes) });
    onProgress?.({ done: i + 1, total: files.length });
  }

  return { vaultId: newVaultId(), manifest: buildManifest(salt, files.length), blobs };
}

/** Upload ciphertext + manifest to Supabase Storage (authenticated). HLD §7. */
export async function uploadVault(
  vault: EncryptedVault,
  onProgress?: (p: EncryptProgress) => void,
): Promise<void> {
  const total = vault.blobs.length + 1;
  let done = 0;
  const tick = () => onProgress?.({ done: ++done, total });

  for (const blob of vault.blobs) {
    // Copy into a plain ArrayBuffer: a Uint8Array view may sit on a larger
    // buffer, and supabase-js would upload the whole backing store.
    const body = blob.bytes.slice().buffer;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${vault.vaultId}/${blob.name}`, body, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    if (error) throw new Error(`Upload failed for ${blob.name}: ${error.message}`);
    tick();
  }

  const manifestBody = new TextEncoder().encode(JSON.stringify(vault.manifest)).slice().buffer;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${vault.vaultId}/manifest.json`, manifestBody, {
      contentType: 'application/json',
      upsert: false,
    });
  if (error) throw new Error(`Upload failed for manifest: ${error.message}`);
  tick();
}

/** Fetch and validate a manifest from public storage (recipient side). */
export async function fetchManifest(vaultId: string): Promise<Manifest> {
  const res = await fetch(publicUrl(`${vaultId}/manifest.json`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Vault not found (${res.status})`);
  return parseManifest(await res.json());
}

/** Fetch one ciphertext blob from public storage. */
export async function fetchBlob(vaultId: string, encFile: string): Promise<Bytes> {
  const res = await fetch(publicUrl(`${vaultId}/${encFile}`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Blob ${encFile} not found (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface DecryptedPhoto {
  header: PhotoHeader;
  blob: Blob;
}

/**
 * Derive the key once and hand back a reusable decryptor. The viewer decrypts
 * many blobs under one code, so we avoid re-running the 600k-iteration KDF per
 * photo — that would make a 20-photo vault unbearably slow.
 */
export async function makeDecryptor(
  manifest: Manifest,
  code: string,
): Promise<(bytes: Bytes) => Promise<DecryptedPhoto>> {
  const key = await deriveKey(code, fromBase64(manifest.salt), manifest.kdf.iter);
  return async (bytes: Bytes) => {
    const { header, bytes: plain } = await decryptPhoto(key, bytes);
    return { header, blob: new Blob([plain.slice().buffer], { type: header.type }) };
  };
}

/** Trigger a browser download of a Blob under a given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

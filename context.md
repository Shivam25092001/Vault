# Context — Encrypted Photo Vault (as built)

This is the implementation reference. The authority for *why* is `HLD.md`; this
file records *what exists* and *where*. When they disagree, HLD.md wins and this
file is stale — fix it.

**Status:** implemented (build order §10 steps 1–6 complete).
**Last updated:** 2026-07-18

---

## What this is

Client-side encrypted photo vault. An admin picks photos and a code; photos are
encrypted in the browser with AES-GCM under a PBKDF2-derived key; ciphertext is
uploaded to Supabase Storage. Recipients open a share link, type the code, and the
photos are decrypted in their browser. Plaintext and the code never leave the
device; the server holds only opaque bytes. See `HLD.md` §1–4 for the security model
and the **accepted risks** (short codes are brute-forceable, sharing is irreversible,
EXIF survives, photo count/sizes leak) — those are settled decisions, not bugs.

## Layout

```
src/
  lib/
    crypto.ts        Pure crypto core: PBKDF2 + AES-GCM, framing, manifest. No I/O.
    crypto.test.ts   26 tests: round-trip byte-identical, wrong-code-fails-closed, IV uniqueness…
    vault.ts         Orchestration: encrypt a File[] → blobs+manifest; upload; fetch; decrypt.
    supabase.ts      Supabase client + public-URL helper. Bucket name lives here.
    useAuth.ts       React hook wrapping the Supabase auth session.
  routes/
    Encrypt.tsx      /encrypt — admin: sign in, pick photos, encrypt, publish or download.
    Viewer.tsx       /v/:id — public: fetch manifest, prompt code, decrypt, render gallery.
                     Also /v/local — load downloaded blobs to decrypt offline.
  components/
    Shell.tsx        Aubergine/foil chrome.
  App.tsx            Router (createBrowserRouter).
  main.tsx           Entry.
  styles.css         Design shell.
```

## Crypto (matches HLD §5–6)

- **KDF:** PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte salt, → 256-bit AES-GCM key.
  Derived once per vault; the key is non-extractable.
- **Cipher:** AES-GCM-256, 128-bit tag, **12-byte IV fresh per file**.
- **`.enc` layout:** `IV(12) ‖ ciphertext ‖ tag(16)`.
- **Framed plaintext (inside the ciphertext):** `headerLen(4, BE u32) ‖ header JSON ‖ raw bytes`,
  where header is `{name, type}`. Framing the header inside the encrypted region is
  what keeps filenames/MIME types secret; storage object names are opaque (`001.enc`).
- **Wrong code = GCM auth failure**, surfaced as `WrongCodeError`. No verifier blob.
- **`manifest.json`** carries only `{v, kdf, salt, items:[{enc}]}` — no code material,
  no filenames. `parseManifest` validates untrusted manifests and clamps `iter` so a
  tampered one can't wedge the tab.

`crypto.ts` is pure and I/O-free, so it tests under Node's WebCrypto — the same
primitives the browser exposes as `crypto.subtle`.

## Storage (matches HLD §9)

- Supabase bucket **`vaults`**, public-read, authenticated-write (two storage policies).
- Layout: `vaults/<vaultId>/manifest.json`, `vaults/<vaultId>/001.enc`, …
- `vaultId`: 16 random bytes, base64url — unguessable capability URL.
- Config via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (both public-safe). The
  write gate is the INSERT policy, not the key. **Never** put the service_role key here.

## Flows

- **Encrypt & publish** (`/encrypt`): sign in → pick photos → declare code →
  `encryptVault` (one salt, one key, per-file IV) → `uploadVault` (authenticated) →
  emit `/v/<id>` share link. A **download-locally** path needs no cloud (build steps 3–4).
- **View & decrypt** (`/v/:id`): `fetchManifest` → prompt code → `makeDecryptor`
  (derives key once) → per item: `fetchBlob` → decrypt → object URL → `<img>`. Object
  URLs are revoked on unmount. Wrong code reveals nothing.

## Commands

```
npm install         # then `npm approve-scripts esbuild` once (script gating)
npm run dev         # localhost dev (secure context — crypto.subtle works)
npm test            # vitest: crypto round-trip + fail-closed suite
npm run typecheck   # tsc -b --noEmit
npm run build       # tsc -b && vite build → dist/
```

**Hard requirement (HLD §8):** `crypto.subtle` needs a secure context — HTTPS or
`localhost`. Opening the build from `file://` will not work.

## Deploy

Static host (Netlify / Vercel / Cloudflare Pages / GH Pages). SPA deep links
(`/v/:id`) require a catch-all rewrite to `index.html`:
- `public/_redirects` — Netlify / Cloudflare Pages.
- `vercel.json` — Vercel.
Set the two `VITE_` env vars in the host's build settings. See `SETUP.md` for the
one-time Supabase configuration.

## Not built (deliberately — HLD §2, §12)

Multi-user, revocation, editing/deleting a vault, server-side thumbnails, EXIF
stripping, Argon2, streaming encryption for very large files. v1 is write-once.
```

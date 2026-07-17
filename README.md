# Vault — client-side encrypted file vault

Encrypt files in your browser, share a link, and let only holders of a secret
**code** open them. Files are encrypted with AES-GCM under a key derived from the
code; the ciphertext is stored in Supabase. **Plaintext and the code never leave the
device, and the server only ever holds opaque bytes.**

- **Live app:** https://we-vault.vercel.app/
- **Design authority:** [`HLD.md`](./HLD.md) — read it before changing behavior.
- **Setup guide:** [`SETUP.md`](./SETUP.md)

## How it works

```
Admin browser                     Supabase                  Recipient browser
─────────────                     ────────                  ─────────────────
pick files + code                                           open /v/<id>
  │                                                            │
  ├─ PBKDF2(code, salt) ─► key                                 ├─ fetch manifest (public)
  ├─ AES-GCM encrypt each file                                 ├─ prompt for code
  └─ upload ciphertext ──────────► vaults/<id>/*.enc ────────► ├─ PBKDF2(code, salt) ─► key
     (authenticated write)         manifest.json (public)      └─ AES-GCM decrypt ─► render
```

- **Wrong code → GCM authentication fails → nothing decrypts.** There is no separate
  password check to attack; the cipher itself is the gate.
- The code travels **out-of-band** (spoken, separate message). It is never uploaded,
  never in the manifest, never hashed anywhere.
- There is **no application server**. The "backend" is Supabase configuration only
  (a public bucket + two storage policies + one admin user).

See [`HLD.md`](./HLD.md) §4–§6 for the full security model, cryptographic parameters,
and the deliberately **accepted risks** (short codes are brute-forceable offline,
sharing is irreversible, file count/sizes leak).

## Tech stack

| Layer | Choice |
|---|---|
| App | Vite + React + TypeScript |
| Crypto | Native WebCrypto (`crypto.subtle`) — no crypto libraries |
| Storage / Auth | Supabase (bucket `vaults`, single admin user) |
| Hosting | Vercel (static) |

**Secure context required:** `crypto.subtle` only works over HTTPS or on `localhost`.
Opening the build from `file://` will not work.

## Getting started

```bash
npm install
npm approve-scripts esbuild   # one-time: allow esbuild's install script
cp .env.example .env          # then fill in your Supabase URL + anon key
npm run dev
```

Environment variables (both public-safe — they ship in the client bundle by design):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

The one-time Supabase setup (bucket, policies, admin user) is in [`SETUP.md`](./SETUP.md).

## Scripts

```bash
npm run dev         # dev server (localhost — secure context, crypto works)
npm test            # vitest: crypto round-trip + fail-closed suite (30 tests)
npm run typecheck   # tsc -b --noEmit
npm run build       # tsc -b && vite build → dist/
npm run preview     # serve the production build locally
```

## Routes

| Route | Who | Purpose |
|---|---|---|
| `/encrypt` | Admin | Sign in, pick files, encrypt, publish to cloud or download locally |
| `/v/:id` | Public | Fetch manifest, prompt for code, decrypt, list/preview files |
| `/v/local` | — | Decrypt locally-downloaded blobs offline (no cloud) |

## Project structure

```
src/
  lib/
    crypto.ts        Pure crypto core: PBKDF2 + AES-GCM, framing, manifest (no I/O)
    crypto.test.ts   Round-trip byte-identical, wrong-code-fails-closed, IV uniqueness
    vault.ts         Orchestration: encrypt File[] → blobs+manifest; upload; fetch; decrypt
    vault.test.ts    End-to-end vault round trip against real File objects
    supabase.ts      Supabase client + public-URL helper
    useAuth.ts       Admin auth session hook
    format.ts        Size / extension helpers
  routes/
    Encrypt.tsx      /encrypt
    Viewer.tsx       /v/:id and /v/local
  components/        Brand, Shell
  styles.css         Design system (dark slate-blue; Manrope + Space Grotesk)
```

## Deployment

Any static host over HTTPS. SPA deep links (`/v/:id`) need a catch-all rewrite to
`index.html` — already configured for Vercel ([`vercel.json`](./vercel.json)) and
Netlify / Cloudflare Pages ([`public/_redirects`](./public/_redirects)). Set the two
`VITE_` env vars in the host's build environment (Vite inlines them at build time, so
they must exist before the build runs).

```bash
vercel --prod        # deploy to Vercel
```

## License

Private project. All rights reserved.

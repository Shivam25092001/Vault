# Setup

## 1. Install & run locally

```
npm install
npm approve-scripts esbuild   # one-time: allow esbuild's install script
npm run dev
```

Open the printed `localhost` URL. `crypto.subtle` requires a secure context, so
`localhost` (or HTTPS in production) is mandatory — `file://` will not work.

Copy `.env.example` to `.env` and fill in the two values from Supabase. Both are
public-safe and ship in the client bundle by design.

## 2. Supabase (one-time, manual — HLD §9)

1. **Create a project.** Note the **Project URL** and **anon/publishable key**
   (Project Settings → API Keys). Never use the `service_role` / secret key here.
2. **Create bucket `vaults`**, marked **Public**. Under additional config, raise the
   file-size limit (e.g. 50 MB) and leave **allowed MIME types empty** — uploads are
   opaque `application/octet-stream` blobs, so restricting to `image/*` would reject them.
3. **Storage policies** on `storage.objects` (SQL Editor):

   ```sql
   create policy "Public read on vaults"
   on storage.objects for select
   to public
   using ( bucket_id = 'vaults' );

   create policy "Authenticated write on vaults"
   on storage.objects for insert
   to authenticated
   with check ( bucket_id = 'vaults' );
   ```

   The INSERT policy is the real write gate. (The SELECT policy is redundant while the
   bucket is public, but matches the design and future-proofs a switch to private.)
4. **Create one admin user** (Authentication → Users → Add user → Create new user,
   with "Auto Confirm User" ticked).
5. **Close signups**: Authentication → Email provider stays **enabled**, but turn off
   "Allow new users to sign up". Registration must be closed or a stranger could obtain
   the `authenticated` role and write to your bucket.

## 3. `.env`

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

## 4. Deploy

Build with `npm run build`, deploy `dist/` to any static host over HTTPS. Set the two
`VITE_` vars in the host's environment. Deep-link rewrites for `/v/:id` are already
configured in `public/_redirects` (Netlify/Cloudflare) and `vercel.json` (Vercel).

## 5. Smoke test the round trip

1. `/encrypt` → sign in → pick a couple of photos → type a code → **Encrypt & publish**.
2. Open the emitted `/v/<id>` link (or paste it in a private window).
3. Type the code → photos render. Type a wrong code → "Wrong code. Nothing to see."

Offline variant (no cloud): use **Encrypt & download locally**, then open `/v/local`
and select the downloaded `manifest.json` + `.enc` files.

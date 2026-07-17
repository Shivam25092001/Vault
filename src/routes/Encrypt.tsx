import { useEffect, useMemo, useRef, useState } from 'react';
import { Shell } from '../components/Shell';
import { Brand } from '../components/Brand';
import { useAuth } from '../lib/useAuth';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { encryptVault, uploadVault, downloadBlob, type EncryptProgress } from '../lib/vault';
import { formatSize, extOf, isImageType } from '../lib/format';

type Phase = 'pick' | 'working' | 'published' | 'downloaded';

export function Encrypt() {
  const { session, loading } = useAuth();
  const [showAccount, setShowAccount] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('pick');
  const [progress, setProgress] = useState<EncryptProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const thumbs = useThumbnails(files);
  const busy = phase === 'working';
  const canGo = files.length > 0 && code.length > 0 && !busy;

  const avatarInitials = session?.user.email?.[0]?.toUpperCase() ?? 'A';

  async function publish() {
    setError(null);
    setPhase('working');
    try {
      const vault = await encryptVault(files, code, setProgress);
      await uploadVault(vault, setProgress);
      setShareUrl(`${location.origin}/v/${vault.vaultId}`);
      setPhase('published');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    }
  }

  async function downloadLocal() {
    setError(null);
    setPhase('working');
    try {
      const vault = await encryptVault(files, code, setProgress);
      for (const blob of vault.blobs) {
        downloadBlob(new Blob([blob.bytes.slice().buffer]), `${vault.vaultId}__${blob.name}`);
      }
      downloadBlob(
        new Blob([JSON.stringify(vault.manifest, null, 2)], { type: 'application/json' }),
        `${vault.vaultId}__manifest.json`,
      );
      setPhase('downloaded');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    }
  }

  function reset() {
    setFiles([]);
    setCode('');
    setProgress(null);
    setShareUrl(null);
    setCopied(false);
    setError(null);
    setPhase('pick');
  }

  return (
    <Shell>
      <div className="appbar">
        <Brand />
        <button
          className={`avatar${showAccount ? ' on' : ''}`}
          onClick={() => setShowAccount((v) => !v)}
          title="Account"
          aria-label="Account"
        >
          {avatarInitials}
        </button>
      </div>

      {showAccount && <AccountPanel session={session} loading={loading} />}

      <div className="section-head">
        <h1 className="h1">Create a vault</h1>
        <p className="lead">
          Files are encrypted in this browser. The code never leaves this tab — share it out-of-band.
        </p>
      </div>

      {phase === 'published' && shareUrl ? (
        <>
          <div className="share">
            <div className="title">Vault published — share these separately</div>
            <div className="linkrow">
              <div className="url">{shareUrl}</div>
              <button
                className="linkbtn"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              Tell the recipient the code by other means. Sharing is irreversible — assume anything
              published is permanent.
            </p>
          </div>
          <div className="btn-row" style={{ marginTop: 20 }}>
            <button className="btn ghost" onClick={reset}>
              Create another vault
            </button>
          </div>
        </>
      ) : phase === 'downloaded' ? (
        <>
          <div className="share">
            <div className="title">Encrypted files downloaded</div>
            <p className="hint" style={{ marginTop: 0 }}>
              Blobs + manifest saved locally. Open <code>/v/local</code> in the viewer to decrypt them
              offline.
            </p>
          </div>
          <div className="btn-row" style={{ marginTop: 20 }}>
            <button className="btn ghost" onClick={reset}>
              Create another vault
            </button>
          </div>
        </>
      ) : (
        <>
          <FilePicker files={files} onChange={setFiles} disabled={busy} />

          {files.length > 0 && (
            <div className="card pad-tight">
              {files.map((f, i) => (
                <div className="file-row" key={`${f.name}-${i}`}>
                  <div className="ext">
                    {thumbs.get(f) ? <img src={thumbs.get(f)} alt="" /> : extOf(f.name)}
                  </div>
                  <div className="file-meta">
                    <div className="file-name">{f.name}</div>
                    <div className="file-sub">{formatSize(f.size)}</div>
                  </div>
                  <button
                    className="row-action danger"
                    disabled={busy}
                    onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <label className="field-label" htmlFor="code">
              Vault code
            </label>
            <input
              id="code"
              className="input"
              type="text"
              autoComplete="off"
              placeholder="e.g. a phrase you'll tell the recipient"
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className="hint">
              Anyone with this code and the link can open the vault. Use a passphrase, not a single
              word — short codes are brute-forceable offline.
            </div>
          </div>

          {error && <p className="err">{error}</p>}

          {busy ? (
            <div className="card">
              <div className="inline-status">
                <span className="spinner" /> Encrypting &amp; uploading…
              </div>
              {progress && (
                <>
                  <div className="progress">
                    <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                  <div className="file-sub">
                    {progress.done} / {progress.total}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="btn-row">
              <button
                className="btn grow"
                disabled={!canGo || !session}
                onClick={publish}
                title={!session ? 'Sign in to publish' : ''}
              >
                Encrypt &amp; publish
              </button>
              <button className="btn ghost grow" disabled={!canGo} onClick={downloadLocal}>
                Encrypt &amp; download locally
              </button>
            </div>
          )}

          {!session && (
            <p className="footnote" style={{ marginTop: 14 }}>
              Local encrypt &amp; download works without an account. Open the account menu to sign in
              and publish to the cloud.
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

function FilePicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (f: File[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function add(list: FileList | null) {
    if (!list) return;
    onChange([...files, ...Array.from(list)]);
  }

  return (
    <div
      className={`dropzone${drag ? ' drag' : ''}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled) add(e.dataTransfer.files);
      }}
    >
      <div className="up" aria-hidden>
        ↑
      </div>
      <div className="big">
        {files.length === 0
          ? 'Drop any files here, or tap to choose'
          : `${files.length} file${files.length === 1 ? '' : 's'} selected — tap to add more`}
      </div>
      <div className="small">Documents, images, video, archives — anything.</div>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}

function AccountPanel({
  session,
  loading,
}: {
  session: ReturnType<typeof useAuth>['session'];
  loading: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return null;

  if (session) {
    const initials = session.user.email?.slice(0, 2).toUpperCase() ?? 'ME';
    return (
      <div className="account">
        <div
          className="ext"
          style={{ width: 36, height: 36, borderRadius: '50%', background: 'oklch(0.3 0.1 255)' }}
        >
          {initials}
        </div>
        <div className="grow">
          <div className="title">Signed in as {session.user.email}</div>
          <div className="desc">You can publish vaults to the cloud.</div>
        </div>
        <button className="linkbtn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  }

  return (
    <form className="account" onSubmit={signIn}>
      <div className="grow">
        <div className="title">Sign in to publish</div>
        <div className="desc">
          {supabaseConfigured
            ? 'Local encrypt & download works without an account.'
            : 'Supabase is not configured — only local download is available.'}
        </div>
      </div>
      <input
        className="input"
        type="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="input pw"
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="btn sm" disabled={busy || !email || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {err && (
        <p className="err" style={{ width: '100%', margin: '4px 0 0' }}>
          {err}
        </p>
      )}
    </form>
  );
}

/** Object-URL thumbnails for image previews, revoked on change/unmount (HLD §7). */
function useThumbnails(files: File[]): Map<File, string> {
  const map = useMemo(() => new Map<File, string>(), []);
  const [, force] = useState(0);

  useEffect(() => {
    let changed = false;
    for (const f of files) {
      if (!map.has(f) && isImageType(f.type)) {
        map.set(f, URL.createObjectURL(f));
        changed = true;
      }
    }
    for (const [f, url] of map) {
      if (!files.includes(f)) {
        URL.revokeObjectURL(url);
        map.delete(f);
        changed = true;
      }
    }
    if (changed) force((n) => n + 1);
  }, [files, map]);

  useEffect(() => {
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, [map]);

  return map;
}

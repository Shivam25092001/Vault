import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Brand } from '../components/Brand';
import { WrongCodeError, parseManifest, type Manifest, type Bytes } from '../lib/crypto';
import { fetchManifest, fetchBlob, makeDecryptor, downloadBlob } from '../lib/vault';
import { formatSize, extOf, isImageType } from '../lib/format';

type Source =
  | { kind: 'cloud'; vaultId: string }
  | { kind: 'local'; manifest: Manifest; blobs: Map<string, Bytes> };

interface Item {
  name: string;
  type: string;
  blob: Blob;
  url: string | null; // object URL for image display; null for non-images
}

export function Viewer() {
  const { id } = useParams();
  const isLocal = id === 'local';
  const [source, setSource] = useState<Source | null>(null);

  if (isLocal && !source) {
    return (
      <Shell center maxWidth={440}>
        <Brand sm />
        <div style={{ height: 32 }} />
        <div style={{ width: '100%' }}>
          <h1 className="h1" style={{ textAlign: 'center' }}>
            Local viewer
          </h1>
          <p className="lead" style={{ textAlign: 'center', marginBottom: 24 }}>
            Load a manifest and its .enc blobs to decrypt offline — no cloud.
          </p>
          <LocalLoader onReady={setSource} />
        </div>
      </Shell>
    );
  }

  const resolved: Source = source ?? { kind: 'cloud', vaultId: id! };
  return <VaultView source={resolved} />;
}

function VaultView({ source }: { source: Source }) {
  const [manifest, setManifest] = useState<Manifest | null>(
    source.kind === 'local' ? source.manifest : null,
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'decrypting' | 'done' | 'wrong'>('idle');
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [zoom, setZoom] = useState<string | null>(null);

  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (source.kind !== 'cloud') return;
    let alive = true;
    fetchManifest(source.vaultId)
      .then((m) => alive && setManifest(m))
      .catch((e) => alive && setLoadErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [source]);

  useEffect(() => {
    return () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    };
  }, []);

  const getBytes = useCallback(
    async (encFile: string): Promise<Bytes> => {
      if (source.kind === 'local') {
        const b = source.blobs.get(encFile);
        if (!b) throw new Error(`Missing local blob ${encFile}`);
        return b;
      }
      return fetchBlob(source.vaultId, encFile);
    },
    [source],
  );

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!manifest) return;
    setStatus('decrypting');

    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    setItems([]);

    try {
      const decrypt = await makeDecryptor(manifest, code);
      const out: Item[] = [];
      for (const item of manifest.items) {
        const bytes = await getBytes(item.enc);
        // The first blob is the gate: a wrong code throws here, revealing nothing.
        const { header, blob } = await decrypt(bytes);
        let url: string | null = null;
        if (isImageType(header.type)) {
          url = URL.createObjectURL(blob);
          urls.current.push(url);
        }
        out.push({ name: header.name, type: header.type, blob, url });
        setItems([...out]);
      }
      setStatus('done');
    } catch (err) {
      if (err instanceof WrongCodeError) {
        setStatus('wrong');
      } else {
        setLoadErr(err instanceof Error ? err.message : String(err));
        setStatus('idle');
      }
    }
  }

  function saveAll() {
    for (const it of items) downloadBlob(it.blob, it.name);
  }

  if (loadErr) {
    return (
      <Shell center maxWidth={440}>
        <Brand sm />
        <div style={{ height: 32 }} />
        <div className="card" style={{ width: '100%' }}>
          <p className="err" style={{ marginBottom: 8 }}>
            {loadErr}
          </p>
          <p className="footnote">The link may be wrong, or the vault no longer exists.</p>
        </div>
      </Shell>
    );
  }

  if (!manifest) {
    return (
      <Shell center maxWidth={440}>
        <Brand sm />
        <div style={{ height: 32 }} />
        <div className="card" style={{ width: '100%' }}>
          <div className="inline-status">
            <span className="spinner" /> Loading vault…
          </div>
        </div>
      </Shell>
    );
  }

  const count = manifest.items.length;
  const countLabel = `${count} file${count === 1 ? '' : 's'}`;

  // ---- Locked ----
  if (status !== 'done') {
    return (
      <Shell center maxWidth={440}>
        <Brand sm />
        <div style={{ height: 32 }} />
        <div style={{ width: '100%' }}>
          <h1 className="h1" style={{ textAlign: 'center', fontSize: 'clamp(22px, 6vw, 26px)' }}>
            A vault was shared with you
          </h1>
          <p className="lead" style={{ textAlign: 'center', marginBottom: 28 }}>
            {countLabel}. Enter the code you were given to decrypt it.
          </p>

          <form className="card" onSubmit={unlock}>
            <label className="field-label" htmlFor="code">
              Vault code
            </label>
            <input
              id="code"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="Enter the passphrase"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ marginBottom: 14 }}
            />
            {status === 'wrong' && (
              <p className="err">Incorrect code. Check with whoever shared this link and try again.</p>
            )}
            <button className="btn block" disabled={status === 'decrypting' || !code}>
              {status === 'decrypting' ? (
                <>
                  <span className="spinner" /> Decrypting…
                </>
              ) : (
                'Unlock vault'
              )}
            </button>
          </form>
          <p className="footnote center" style={{ marginTop: 20 }}>
            Decryption happens in your browser. The code and file contents are never sent to a server.
          </p>
        </div>
      </Shell>
    );
  }

  // ---- Unlocked ----
  return (
    <Shell center maxWidth={760}>
      <Brand sm />
      <div style={{ height: 28 }} />
      <div style={{ width: '100%' }}>
        <div className="section-head">
          <h1 className="h1">Vault unlocked</h1>
          <p className="lead">
            {items.length} file{items.length === 1 ? '' : 's'} decrypted in your browser. Nothing is
            written to disk until you save a file.
          </p>
        </div>

        <div className="btn-row" style={{ marginBottom: 20 }}>
          <button className="btn sm" onClick={saveAll}>
            Save all
          </button>
          <button className="btn ghost sm" onClick={() => setView(view === 'list' ? 'grid' : 'list')}>
            {view === 'list' ? 'View as grid' : 'View as list'}
          </button>
        </div>

        {view === 'list' ? (
          <div className="card pad-tight">
            {items.map((it, i) => (
              <div className="file-row" key={i}>
                <div className="ext">
                  {it.url ? <img src={it.url} alt="" /> : extOf(it.name)}
                </div>
                <div className="file-meta">
                  <div className="file-name">{it.name}</div>
                  <div className="file-sub">{formatSize(it.blob.size)}</div>
                </div>
                <button className="row-action" onClick={() => downloadBlob(it.blob, it.name)}>
                  Save
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid">
            {items.map((it, i) => (
              <figure key={i}>
                {it.url ? (
                  <img
                    src={it.url}
                    alt={it.name}
                    loading="lazy"
                    onClick={() => setZoom(it.url)}
                  />
                ) : (
                  <div className="nonimg">
                    <span className="tag">{extOf(it.name)}</span>
                    <span className="nm" title={it.name}>
                      {it.name}
                    </span>
                    <button className="row-action" onClick={() => downloadBlob(it.blob, it.name)}>
                      Save
                    </button>
                  </div>
                )}
              </figure>
            ))}
          </div>
        )}

        <p className="footnote center" style={{ marginTop: 20 }}>
          Close this tab to discard the decrypted copies.
        </p>
      </div>

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </Shell>
  );
}

/** Loads a manifest.json + .enc files the admin downloaded, for offline testing. */
function LocalLoader({ onReady }: { onReady: (s: Source) => void }) {
  const [err, setErr] = useState<string | null>(null);

  async function load(fileList: FileList | null) {
    if (!fileList) return;
    setErr(null);
    try {
      const files = Array.from(fileList);
      const manifestFile = files.find((f) => f.name.endsWith('manifest.json'));
      if (!manifestFile) throw new Error('Select the manifest.json along with the .enc files.');
      const manifest = parseManifest(JSON.parse(await manifestFile.text()));

      const blobs = new Map<string, Bytes>();
      for (const item of manifest.items) {
        const f = files.find((x) => x.name.endsWith(item.enc));
        if (!f) throw new Error(`Missing blob for ${item.enc}`);
        blobs.set(item.enc, new Uint8Array(await f.arrayBuffer()));
      }
      onReady({ kind: 'local', manifest, blobs });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <label className="field-label">Select manifest.json and all .enc files</label>
      <input type="file" multiple accept=".json,.enc" onChange={(e) => load(e.target.files)} />
      {err && (
        <p className="err" style={{ marginTop: 12, marginBottom: 0 }}>
          {err}
        </p>
      )}
    </div>
  );
}

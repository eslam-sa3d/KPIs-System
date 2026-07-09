'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api-client';

/** Public share link + QR (client-generated, no external network call). */
export function ShareLinkPanel({ formId, publicToken }: { formId: string; publicToken: string | null }) {
  const [token, setToken] = useState(publicToken);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);

  const url = token && typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname.replace(/forms\/.*/, '')}f/?t=${token}`
    : null;

  useEffect(() => {
    if (!url) return setQr(null);
    QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: '#4f008c' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const result = await api<{ publicToken: string | null }>(`/v1/forms/${formId}/share-link`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      setToken(result.publicToken);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const embedSnippet = url
    ? `<iframe src="${url}" width="640" height="480" frameborder="0" title="pulse form">Loading…</iframe>`
    : null;

  async function copyEmbed() {
    if (!embedSnippet) return;
    await navigator.clipboard.writeText(embedSnippet);
    setEmbedCopied(true);
    setTimeout(() => setEmbedCopied(false), 2000);
  }

  return (
    <div className="admin-card share-panel">
      <h2>public share link</h2>
      <p className="muted">
        anyone with this link can submit a response without signing in — like a Microsoft Forms
        share link. Disabling it (or rotating) invalidates the previous link immediately.
      </p>

      {!token ? (
        <button className="btn-primary" onClick={() => toggle(true)} disabled={busy}>
          {busy ? 'creating…' : 'create public link'}
        </button>
      ) : (
        <div className="share-panel-active">
          <div className="share-link-row">
            <code className="share-link-url">{url}</code>
            <button className="btn-ghost" onClick={copy}>{copied ? 'copied!' : 'copy'}</button>
          </div>
          {qr && <img src={qr} alt="QR code for the public form link" width={140} height={140} />}

          {embedSnippet && (
            <div className="share-link-row" style={{ marginTop: 12 }}>
              <code className="share-link-url">{embedSnippet}</code>
              <button className="btn-ghost" onClick={copyEmbed}>
                {embedCopied ? 'copied!' : 'copy embed code'}
              </button>
            </div>
          )}

          <div className="page-title-row" style={{ justifyContent: 'flex-start' }}>
            <button className="btn-ghost" onClick={() => toggle(true)} disabled={busy}>
              rotate link
            </button>
            <button className="btn-ghost" onClick={() => toggle(false)} disabled={busy}>
              disable
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

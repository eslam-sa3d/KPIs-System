'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { API_URL, api } from '../lib/api-client';
import { Button } from '@/components/ui/button';

/** Public share link + QR (client-generated, no external network call). */
export function ShareLinkPanel({
  formId,
  publicToken,
  exportToken,
}: {
  formId: string;
  publicToken: string | null;
  exportToken: string | null;
}) {
  const [token, setToken] = useState(publicToken);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [xToken, setXToken] = useState(exportToken);
  const [xBusy, setXBusy] = useState(false);
  const [xCopied, setXCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmDisableExport, setConfirmDisableExport] = useState(false);
  const exportUrl = xToken ? `${API_URL}/api/v1/public/forms/export/${xToken}` : null;

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
    setError(null);
    try {
      const result = await api<{ publicToken: string | null }>(`/v1/forms/${formId}/share-link`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      setToken(result.publicToken);
      setConfirmDisable(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
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

  async function toggleExportLink(enabled: boolean) {
    setXBusy(true);
    setError(null);
    try {
      const result = await api<{ exportToken: string | null }>(`/v1/forms/${formId}/export-link`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      setXToken(result.exportToken);
      setConfirmDisableExport(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setXBusy(false);
    }
  }

  async function copyExportUrl() {
    if (!exportUrl) return;
    await navigator.clipboard.writeText(exportUrl);
    setXCopied(true);
    setTimeout(() => setXCopied(false), 2000);
  }

  return (
    <div className="admin-card share-panel">
      <h2>public share link</h2>
      <p className="muted">
        anyone with this link can submit a response without signing in — like a Microsoft Forms
        share link. Disabling it (or rotating) invalidates the previous link immediately.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {!token ? (
        <Button onClick={() => toggle(true)} disabled={busy}>
          {busy ? 'creating…' : 'create public link'}
        </Button>
      ) : (
        <div className="share-panel-active">
          <div className="share-link-row">
            <code className="share-link-url">{url}</code>
            <Button variant="ghost" size="sm" onClick={copy}>{copied ? 'copied!' : 'copy'}</Button>
          </div>
          {qr && <img src={qr} alt="QR code for the public form link" width={140} height={140} />}

          {embedSnippet && (
            <div className="share-link-row" style={{ marginTop: 12 }}>
              <code className="share-link-url">{embedSnippet}</code>
              <Button variant="ghost" size="sm" onClick={copyEmbed}>
                {embedCopied ? 'copied!' : 'copy embed code'}
              </Button>
            </div>
          )}

          <div className="page-title-row" style={{ justifyContent: 'flex-start' }}>
            <Button variant="ghost" size="sm" onClick={() => toggle(true)} disabled={busy}>
              rotate link
            </Button>
            {confirmDisable ? (
              <>
                <span className="muted">disable the public link?</span>
                <Button variant="ghost" size="sm" onClick={() => toggle(false)} disabled={busy}>
                  confirm disable
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(false)}>
                  cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(true)} disabled={busy}>
                disable
              </Button>
            )}
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>live export link</h2>
      <p className="muted">
        paste this into Excel's "Get Data → From Web" and refresh anytime for the latest
        responses — the practical equivalent of Microsoft Forms' "Open in Excel". The link
        itself is the access control, so treat it like a password.
      </p>
      {!xToken ? (
        <Button onClick={() => toggleExportLink(true)} disabled={xBusy}>
          {xBusy ? 'creating…' : 'create live export link'}
        </Button>
      ) : (
        <div className="share-panel-active">
          <div className="share-link-row">
            <code className="share-link-url">{exportUrl}</code>
            <Button variant="ghost" size="sm" onClick={copyExportUrl}>{xCopied ? 'copied!' : 'copy'}</Button>
          </div>
          <div className="page-title-row" style={{ justifyContent: 'flex-start' }}>
            <Button variant="ghost" size="sm" onClick={() => toggleExportLink(true)} disabled={xBusy}>
              rotate link
            </Button>
            {confirmDisableExport ? (
              <>
                <span className="muted">disable the live export link?</span>
                <Button variant="ghost" size="sm" onClick={() => toggleExportLink(false)} disabled={xBusy}>
                  confirm disable
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDisableExport(false)}>
                  cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisableExport(true)} disabled={xBusy}>
                disable
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

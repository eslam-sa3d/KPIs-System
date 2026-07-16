'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Public share link + QR (client-generated, no external network call). */
export function ShareLinkPanel({ formId, publicToken }: { formId: string; publicToken: string | null }) {
  const [token, setToken] = useState(publicToken);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const url =
    token && typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname.replace(/forms\/.*/, '')}f/?t=${token}`
      : null;

  useEffect(() => {
    if (!url) return setQr(null);
    let cancelled = false;
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: '#4f008c' } }))
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
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
      setError(cause instanceof Error ? cause.message : 'The request failed');
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
    ? `<iframe src="${url}" width="640" height="480" frameborder="0" title="Pulse form">Loading…</iframe>`
    : null;

  async function copyEmbed() {
    if (!embedSnippet) return;
    await navigator.clipboard.writeText(embedSnippet);
    setEmbedCopied(true);
    setTimeout(() => setEmbedCopied(false), 2000);
  }

  return (
    <Card className="share-panel border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle>Public share link</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="muted">
          Anyone with this link can submit a response without signing in — like a Microsoft Forms share link. Disabling
          it (or rotating) invalidates the previous link immediately.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!token ? (
          <Button onClick={() => toggle(true)} disabled={busy}>
            {busy ? 'Creating…' : 'Create public link'}
          </Button>
        ) : (
          <div className="share-panel-active">
            <div className="share-link-row">
              <code className="share-link-url">{url}</code>
              <Button variant="ghost" size="sm" onClick={copy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            {qr && <img src={qr} alt="QR code for the public form link" width={140} height={140} />}

            {embedSnippet && (
              <div className="share-link-row" style={{ marginTop: 12 }}>
                <code className="share-link-url">{embedSnippet}</code>
                <Button variant="ghost" size="sm" onClick={copyEmbed}>
                  {embedCopied ? 'Copied!' : 'Copy embed code'}
                </Button>
              </div>
            )}

            <div className="page-title-row" style={{ justifyContent: 'flex-start' }}>
              <Button variant="ghost" size="sm" onClick={() => toggle(true)} disabled={busy}>
                Rotate link
              </Button>
              {confirmDisable ? (
                <>
                  <span className="muted">Disable the public link?</span>
                  <Button variant="ghost" size="sm" onClick={() => toggle(false)} disabled={busy}>
                    Confirm disable
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(true)} disabled={busy}>
                  Disable
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

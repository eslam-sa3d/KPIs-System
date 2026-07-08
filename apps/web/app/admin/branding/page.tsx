'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { BrandIdentity } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

export default function BrandingAdminPage() {
  const user = useSession();
  const [identity, setIdentity] = useState<BrandIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user) void api<BrandIdentity>('/v1/branding').then(setIdentity);
  }, [user]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const saved = await api<BrandIdentity>('/v1/branding', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: form.get('companyName'),
          headline: form.get('headline') || undefined,
          tagline: form.get('tagline') || undefined,
          logoUrl: form.get('logoUrl') || undefined,
        }),
      });
      setIdentity(saved);
      setNotice('brand identity saved — the landing page updates immediately');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saving failed');
    }
  }

  return (
    <PortalShell user={user}>
      <h1>branding</h1>
      <p className="portal-subtitle">customize the company identity on the landing page</p>

      {identity === null ? (
        <p className="muted">loading…</p>
      ) : (
        <form className="builder admin-card" onSubmit={onSave}>
          <label htmlFor="b-name">company name</label>
          <input id="b-name" name="companyName" defaultValue={identity.companyName} required />
          <label htmlFor="b-headline">landing headline</label>
          <input id="b-headline" name="headline" defaultValue={identity.headline ?? ''} />
          <label htmlFor="b-tagline">tagline</label>
          <input id="b-tagline" name="tagline" defaultValue={identity.tagline ?? ''} />
          <label htmlFor="b-logo">logo URL (optional — defaults to the pulse logo)</label>
          <input id="b-logo" name="logoUrl" defaultValue={identity.logoUrl ?? ''} />
          <button className="btn-primary" type="submit">
            save identity
          </button>
          {notice && <p className="form-notice">{notice}</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      )}
    </PortalShell>
  );
}

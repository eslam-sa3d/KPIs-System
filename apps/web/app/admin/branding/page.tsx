'use client';

import { FormEvent, useState } from 'react';
import type { BrandIdentity } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';
import { useResource } from '../../../lib/use-resource';

export default function BrandingAdminPage() {
  const user = useSession();
  const { data: identity, setData: setIdentity } = useResource<BrandIdentity>(user ? '/v1/branding' : null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice('Brand identity saved — the landing page updates immediately');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saving failed');
    }
  }

  return (
    <PortalShell user={user}>
      <h1>Branding</h1>
      <p className="portal-subtitle">Customize the company identity on the landing page</p>

      {identity === null ? (
        <LoadingState />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form className="builder" onSubmit={onSave}>
              <label htmlFor="b-name">Company name</label>
              <Input id="b-name" name="companyName" defaultValue={identity.companyName} required />
              <label htmlFor="b-headline">Landing headline</label>
              <Input id="b-headline" name="headline" defaultValue={identity.headline ?? ''} />
              <label htmlFor="b-tagline">Tagline</label>
              <Input id="b-tagline" name="tagline" defaultValue={identity.tagline ?? ''} />
              <label htmlFor="b-logo">Logo URL (optional — defaults to the pulse logo)</label>
              <Input id="b-logo" name="logoUrl" defaultValue={identity.logoUrl ?? ''} />
              <Button type="submit">Save identity</Button>
              <div className="space-y-2 mb-4">
                {notice && (
                  <Alert>
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </PortalShell>
  );
}

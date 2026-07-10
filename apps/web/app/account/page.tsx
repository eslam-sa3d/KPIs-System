'use client';

import { FormEvent, useState } from 'react';
import { PortalShell } from '../../components/portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { changePassword, logout } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';

export default function AccountPage() {
  const user = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('newPassword'));
    const confirm = String(form.get('confirmPassword'));
    if (newPassword !== confirm) {
      setError("new passwords don't match");
      return;
    }
    setPending(true);
    try {
      await changePassword(String(form.get('currentPassword')), newPassword);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'something went wrong — please retry');
      setPending(false);
    }
  }

  return (
    <PortalShell user={user}>
      <h1>account</h1>
      <p className="portal-subtitle">{user?.email}</p>

      <Card>
        <CardHeader>
          <CardTitle>change password</CardTitle>
          <CardDescription>
            changing your password signs you out of every other device — you&apos;ll need to sign in again here
            too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <>
              <Alert>
                <AlertDescription>password changed. sign in again to continue.</AlertDescription>
              </Alert>
              <Button
                className="mt-4"
                onClick={async () => {
                  await logout();
                  window.location.href = '/login';
                }}
              >
                sign in again
              </Button>
            </>
          ) : (
            <form className="builder" onSubmit={onSubmit} aria-busy={pending}>
              <label htmlFor="currentPassword">current password</label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                minLength={8}
                required
              />

              <label htmlFor="newPassword">new password</label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />

              <label htmlFor="confirmPassword">confirm new password</label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={pending}>
                {pending ? 'changing…' : 'change password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  );
}

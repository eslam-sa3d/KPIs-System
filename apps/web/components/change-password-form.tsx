'use client';

import { FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { changePassword, logout } from '../lib/api-client';

export function ChangePasswordForm() {
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

  if (done) {
    return (
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
    );
  }

  return (
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
      <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />

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
  );
}

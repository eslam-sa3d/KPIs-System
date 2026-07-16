'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resetPassword } from '../../lib/api-client';
import { asset } from '../../lib/asset';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
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
      setError("Passwords don't match");
      return;
    }
    setPending(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong — please retry');
      setPending(false);
    }
  }

  if (!token) {
    return (
      <div className="login-card">
        <Image src={asset('/brand/pulse-pos.svg')} alt="Pulse by solutions" width={120} height={52} priority />
        <h1>Invalid link</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This reset link is missing its token — copy the full link from your email, or request a new one.
          </AlertDescription>
        </Alert>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-card">
        <Image src={asset('/brand/pulse-pos.svg')} alt="Pulse by solutions" width={120} height={52} priority />
        <h1>Password reset</h1>
        <Alert>
          <AlertDescription>Your password has been changed — sign in with your new password.</AlertDescription>
        </Alert>
        <Button className="w-full" onClick={() => router.push('/login')}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="login-card" onSubmit={onSubmit} aria-busy={pending}>
      <Image src={asset('/brand/pulse-pos.svg')} alt="Pulse by solutions" width={120} height={52} priority />
      <h1>Choose a new password</h1>

      <label htmlFor="newPassword">New password</label>
      <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />

      <label htmlFor="confirmPassword">Confirm new password</label>
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

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Resetting…' : 'Reset password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary under static export
  return (
    <main className="login-screen" data-surface="purple">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}

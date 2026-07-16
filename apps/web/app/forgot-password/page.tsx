'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { forgotPassword } from '../../lib/api-client';
import { asset } from '../../lib/asset';

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await forgotPassword(String(form.get('email')));
    } finally {
      // Always show the same "check your email" state, success or failure —
      // the backend never reveals whether the address matched an account.
      setPending(false);
      setSent(true);
    }
  }

  return (
    <main className="login-screen" data-surface="purple">
      {sent ? (
        <div className="login-card">
          <Image src={asset('/brand/pulse-pos.svg')} alt="Pulse by solutions" width={120} height={52} priority />
          <h1>Check your email</h1>
          <Alert>
            <AlertDescription>
              If an account matches that address, we&apos;ve sent a link to reset your password. it expires in 60
              minutes.
            </AlertDescription>
          </Alert>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <form className="login-card" onSubmit={onSubmit} aria-busy={pending}>
          <Image src={asset('/brand/pulse-pos.svg')} alt="Pulse by solutions" width={120} height={52} priority />
          <h1>Forgot your password?</h1>
          <p className="muted">Enter your email and we&apos;ll send you a link to reset it.</p>

          <label htmlFor="email">Email</label>
          <Input id="email" name="email" type="email" autoComplete="email" required />

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </form>
      )}
    </main>
  );
}

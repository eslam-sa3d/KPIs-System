'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { login } from '../../lib/api-client';
import { asset } from '../../lib/asset';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const user = await login(String(form.get('email')), String(form.get('password')));
      router.push(user.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong — please retry');
      setPending(false);
    }
  }

  return (
    <main className="login-screen" data-surface="purple">
      <form className="login-card" onSubmit={onSubmit} aria-busy={pending}>
        <Image src={asset('/brand/pulse-pos.svg')} alt="Pulse by solutions" width={120} height={52} priority />
        <h1>Welcome back</h1>

        <label htmlFor="email">Email</label>
        <Input id="email" name="email" type="email" autoComplete="email" required />

        <label htmlFor="password">Password</label>
        <Input id="password" name="password" type="password" autoComplete="current-password" minLength={8} required />
        <Link href="/forgot-password" className="login-forgot-link">
          Forgot password?
        </Link>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}

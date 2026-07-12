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
      await login(String(form.get('email')), String(form.get('password')));
      router.push('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong — please retry');
      setPending(false);
    }
  }

  return (
    <main className="login-screen" data-surface="purple">
      <form
        className="login-card"
        onSubmit={onSubmit}
        aria-busy={pending}
        data-theme="light"
        data-color-mode="light"
      >
        <Image src={asset('/brand/pulse-pos.svg')} alt="pulse by solutions" width={120} height={52} priority />
        <h1>welcome back</h1>

        <label htmlFor="email">email</label>
        <Input id="email" name="email" type="email" autoComplete="email" required />

        <label htmlFor="password">password</label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
        />
        <Link href="/forgot-password" className="login-forgot-link">
          forgot password?
        </Link>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" isDisabled={pending} shouldFitContainer>
          {pending ? 'signing in…' : 'sign in'}
        </Button>
      </form>
    </main>
  );
}

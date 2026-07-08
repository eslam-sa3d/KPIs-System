'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { login } from '../../lib/api-client';

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
      <form className="login-card" onSubmit={onSubmit} aria-busy={pending}>
        <Image src="/brand/pulse-pos.svg" alt="pulse by solutions" width={120} height={52} priority />
        <h1>welcome back</h1>

        <label htmlFor="email">email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />

        <label htmlFor="password">password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
        />

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? 'signing in…' : 'sign in'}
        </button>
      </form>
    </main>
  );
}

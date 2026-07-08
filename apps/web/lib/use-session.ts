'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { restoreSession } from './api-client';

/** Restores the session from the refresh cookie; bounces to /login if absent. */
export function useSession(): AuthenticatedUser | null {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .then((session) => {
        if (cancelled) return;
        if (!session) router.replace('/login');
        else setUser(session);
      })
      .catch(() => router.replace('/login'));
    return () => {
      cancelled = true;
    };
  }, [router]);

  return user;
}

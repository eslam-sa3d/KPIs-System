'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { restoreSession } from './api-client';

const CHANGE_PASSWORD_PATH = '/change-password';

/** Restores the session from the refresh cookie; bounces to /login if absent,
 *  or to /change-password if the account still carries an admin-issued
 *  password it hasn't replaced yet. */
export function useSession(): AuthenticatedUser | null {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .then((session) => {
        if (cancelled) return;
        if (!session) {
          router.replace('/login');
          return;
        }
        // trailingSlash is on (static export), so pathname may arrive as
        // either "/change-password" or "/change-password/" depending on
        // how the navigation happened — strip it before comparing.
        const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
        if (session.mustChangePassword && normalizedPathname !== CHANGE_PASSWORD_PATH) {
          router.replace(CHANGE_PASSWORD_PATH);
          return;
        }
        setUser(session);
      })
      .catch(() => router.replace('/login'));
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  return user;
}

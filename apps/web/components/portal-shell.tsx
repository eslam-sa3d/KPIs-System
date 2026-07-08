'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AuthenticatedUser } from '@pulse/contracts';
import { logout } from '../lib/api-client';
import { asset } from '../lib/asset';

/** Authenticated chrome: brand header + nav, shared by every portal page. */
export function PortalShell({
  user,
  children,
}: {
  user: AuthenticatedUser | null;
  children: React.ReactNode;
}) {
  const router = useRouter();

  async function onSignOut() {
    await logout();
    router.replace('/');
  }

  return (
    <div className="portal">
      <header className="portal-header" data-surface="purple">
        <div className="portal-header-nav">
          <Link href="/dashboard">
            <Image src={asset('/brand/pulse-neg.svg')} alt="pulse by solutions" width={110} height={48} />
          </Link>
          <nav>
            <Link href="/dashboard">dashboard</Link>
            <Link href="/forms">forms</Link>
          </nav>
        </div>
        <div className="portal-header-actions">
          {user && <span className="portal-user">{user.displayName}</span>}
          <button className="btn-ghost" onClick={onSignOut}>
            sign out
          </button>
        </div>
      </header>
      <main className="portal-main">{children}</main>
    </div>
  );
}

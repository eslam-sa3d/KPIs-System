'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AuthenticatedUser } from '@pulse/contracts';
import { logout } from '../lib/api-client';
import { asset } from '../lib/asset';

const NAV_ITEMS: Array<{ href: string; label: string; permission?: string }> = [
  { href: '/dashboard', label: 'dashboard' },
  { href: '/forms', label: 'forms' },
  { href: '/admin/kpis', label: 'KPIs', permission: 'kpis:write' },
  { href: '/admin/users', label: 'users', permission: 'users:read' },
  { href: '/admin/roles', label: 'roles', permission: 'roles:read' },
  { href: '/admin/branding', label: 'branding', permission: 'branding:write' },
  { href: '/admin/settings', label: 'settings', permission: 'settings:manage' },
];

export const can = (user: AuthenticatedUser | null, permission: string): boolean =>
  Boolean(user?.permissions?.includes(permission));

/** Authenticated chrome: brand header + permission-gated nav, shared by every portal page. */
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
            {NAV_ITEMS.filter((item) => !item.permission || can(user, item.permission)).map(
              (item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ),
            )}
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

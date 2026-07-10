'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { logout } from '../lib/api-client';
import { asset } from '../lib/asset';
import { ThemeToggle } from './theme-toggle';

const NAV_ITEMS: Array<{ href: string; label: string; permission?: string }> = [
  { href: '/dashboard', label: 'dashboard' },
  { href: '/forms', label: 'forms' },
  { href: '/admin/kpis', label: 'KPIs', permission: 'kpis:write' },
  { href: '/admin/users', label: 'users', permission: 'users:read' },
  { href: '/admin/roles', label: 'roles', permission: 'roles:read' },
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
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // close the mobile menu on route changes / navigation clicks
  useEffect(() => {
    setMenuOpen(false);
  }, [user]);

  async function onSignOut() {
    await logout();
    router.replace('/');
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(user, item.permission));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="portal">
      <header className="portal-header" data-surface="purple">
        <div className="portal-header-nav">
          <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
            <Image src={asset('/brand/pulse-neg.svg')} alt="pulse by solutions" width={110} height={48} />
          </Link>
          <nav className="portal-nav-desktop" aria-label="main navigation">
            {visibleItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={isActive(item.href) ? 'portal-nav-active' : undefined}
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="portal-header-actions">
          <ThemeToggle />
          <span className="portal-user portal-user-desktop">{user?.displayName}</span>
          <button className="btn-ghost portal-signout-desktop" onClick={onSignOut}>
            sign out
          </button>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="portal-mobile-nav"
            aria-label={menuOpen ? 'close menu' : 'open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className={`nav-toggle-bars${menuOpen ? ' nav-toggle-bars-open' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav
        id="portal-mobile-nav"
        className={`portal-nav-mobile${menuOpen ? ' portal-nav-mobile-open' : ''}`}
        aria-label="main navigation"
        aria-hidden={!menuOpen}
        data-surface="purple"
      >
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuOpen(false)}
            className={isActive(item.href) ? 'portal-nav-active' : undefined}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
        <div className="portal-nav-mobile-footer">
          {user && <span className="portal-user">{user.displayName}</span>}
          <button className="btn-ghost" onClick={onSignOut}>
            sign out
          </button>
        </div>
      </nav>

      <main className="portal-main">{children}</main>
    </div>
  );
}

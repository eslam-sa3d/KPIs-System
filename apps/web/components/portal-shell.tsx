'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { logout } from '../lib/api-client';
import { asset } from '../lib/asset';

const NAV_ITEMS: Array<{ href: string; label: string; icon: string; permission?: string }> = [
  { href: '/dashboard', label: 'dashboard', icon: '▦' },
  { href: '/forms', label: 'forms', icon: '▤' },
  { href: '/admin/kpis', label: 'KPIs', icon: '◎', permission: 'kpis:write' },
  { href: '/admin/users', label: 'users', icon: '◐', permission: 'users:read' },
  { href: '/admin/roles', label: 'roles', icon: '◈', permission: 'roles:read' },
  { href: '/admin/branding', label: 'branding', icon: '◇', permission: 'branding:write' },
  { href: '/admin/settings', label: 'settings', icon: '⚙', permission: 'settings:manage' },
];

const THEME_KEY = 'pulse-portal-theme';

export const can = (user: AuthenticatedUser | null, permission: string): boolean =>
  Boolean(user?.permissions?.includes(permission));

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      /* localStorage unavailable — keep the light default */
    }
  }, []);

  function toggle() {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return { theme, toggle };
}

/**
 * Sidebar + topbar app shell shared by every authenticated page.
 * Self-contained light/dark token system (default light) — independent
 * from the public pulse brand tokens used on the landing/login pages.
 *
 * `title`/`subtitle`/`actions`/`sidebarExtra` are optional: pages that
 * don't pass them keep rendering their own in-content heading, so most
 * pages need zero changes. The dashboard uses the full set.
 */
export function PortalShell({
  user,
  children,
  title,
  subtitle,
  actions,
  sidebarExtra,
}: {
  user: AuthenticatedUser | null;
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  sidebarExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function onSignOut() {
    await logout();
    router.replace('/');
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(user, item.permission));

  return (
    <div className="portal" data-theme={theme}>
      <div
        className={`p-sidebar-backdrop${menuOpen ? ' p-sidebar-backdrop-open' : ''}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`p-sidebar${menuOpen ? ' p-sidebar-open' : ''}`}>
        <div className="p-sidebar-logo">
          <Link href="/dashboard" className="p-logo-mark" onClick={() => setMenuOpen(false)}>
            <Image src={asset('/brand/pulse-icon.png')} alt="" width={32} height={32} style={{ borderRadius: 8 }} unoptimized />
            <div>
              <div className="p-logo-text">pulse</div>
              <div className="p-logo-sub">by solutions</div>
            </div>
          </Link>
        </div>

        <div className="p-sidebar-section">views</div>
        <nav className="p-sidebar-nav" aria-label="main navigation">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`p-nav-item${pathname?.startsWith(item.href) ? ' active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <span aria-hidden="true">{item.icon}</span> {item.label}
            </Link>
          ))}
        </nav>

        {sidebarExtra}

        <div className="p-sidebar-footer">
          {user?.displayName}
          <div className="p-sidebar-footer-row">
            <span className="muted">{user?.roles?.join(', ')}</span>
            <button className="p-theme-toggle" onClick={onSignOut} style={{ padding: '4px 10px' }}>
              sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="p-main">
        <header className="p-topbar">
          <button
            type="button"
            className="p-nav-toggle"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'close menu' : 'open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ☰
          </button>
          <div className="p-topbar-left">
            {title && <div className="p-topbar-title">{title}</div>}
            {subtitle && <div className="p-topbar-sub">{subtitle}</div>}
          </div>
          <div className="p-topbar-right">
            {actions}
            <button className="p-theme-toggle" onClick={toggle} title="Switch theme">
              {theme === 'light' ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </header>

        <main className="portal-main">{children}</main>
      </div>
    </div>
  );
}

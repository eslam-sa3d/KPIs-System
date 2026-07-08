'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { api, logout, restoreSession } from '../../lib/api-client';

interface MyKpi {
  id: string;
  code: string;
  name: string;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  target: string | null; // Prisma Decimal serializes as string
  cadence: string;
  entries: Array<{ value: string; periodStart: string; periodEnd: string }>;
}

type Status = { kind: 'on' | 'off' | 'none'; label: string };

/** Status derives from direction + target; rendered as icon + label, never color alone. */
function statusOf(kpi: MyKpi): Status {
  const latest = kpi.entries[0];
  if (!latest || kpi.target === null) return { kind: 'none', label: 'no target' };
  const value = Number(latest.value);
  const target = Number(kpi.target);
  const onTarget = kpi.direction === 'higher_is_better' ? value >= target : value <= target;
  return onTarget ? { kind: 'on', label: 'on target' } : { kind: 'off', label: 'off target' };
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [kpis, setKpis] = useState<MyKpi[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await restoreSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      if (cancelled) return;
      setUser(session);
      setKpis(await api<MyKpi[]>('/v1/kpis/my'));
    })().catch(() => router.replace('/login'));
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSignOut() {
    await logout();
    router.replace('/');
  }

  return (
    <div className="portal">
      <header className="portal-header" data-surface="purple">
        <Image src="/brand/pulse-neg.svg" alt="pulse by solutions" width={110} height={48} />
        <div className="portal-header-actions">
          {user && <span className="portal-user">{user.displayName}</span>}
          <button className="btn-ghost" onClick={onSignOut}>
            sign out
          </button>
        </div>
      </header>

      <main className="portal-main">
        <h1>dashboard</h1>
        <p className="portal-subtitle">your KPIs, scoped to your roles and department</p>

        {kpis === null ? (
          <p className="muted">loading…</p>
        ) : kpis.length === 0 ? (
          <div className="empty-state">
            <h2>no KPIs assigned yet</h2>
            <p className="muted">
              An admin can map KPIs to your role or department under KPI settings.
            </p>
          </div>
        ) : (
          <section className="tile-grid" aria-label="my KPIs">
            {kpis.map((kpi) => {
              const latest = kpi.entries[0];
              const status = statusOf(kpi);
              return (
                <article key={kpi.id} className="kpi-tile">
                  <header>
                    <span className="kpi-code">{kpi.code}</span>
                    <h3>{kpi.name}</h3>
                  </header>
                  <p className="kpi-value">
                    {latest ? Number(latest.value).toLocaleString() : '—'}
                    <span className="kpi-unit"> {kpi.unit}</span>
                  </p>
                  <footer>
                    <span className="muted">
                      target {kpi.target !== null ? Number(kpi.target).toLocaleString() : '—'} ·{' '}
                      {kpi.cadence}
                    </span>
                    {status.kind !== 'none' && (
                      <span className={`status-chip status-${status.kind}`}>
                        {status.kind === 'on' ? '▲' : '▼'} {status.label}
                      </span>
                    )}
                  </footer>
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}

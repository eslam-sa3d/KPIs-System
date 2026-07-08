'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PortalShell } from '../../components/portal-shell';
import { Sparkline } from '../../components/sparkline';
import { api } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';

// Lazy-loaded: recharts (~90kB) only ships when a tile is opened.
const KpiChart = dynamic(() => import('../../components/kpi-chart'), {
  ssr: false,
  loading: () => <p className="muted">loading chart…</p>,
});

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
  const user = useSession();
  const [kpis, setKpis] = useState<MyKpi[] | null>(null);
  const [openKpiId, setOpenKpiId] = useState<string | null>(null);

  useEffect(() => {
    if (user) void api<MyKpi[]>('/v1/kpis/my').then(setKpis);
  }, [user]);

  const openKpi = kpis?.find((k) => k.id === openKpiId) ?? null;

  return (
    <PortalShell user={user}>
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
            // entries arrive newest-first; sparkline wants chronological
            const series = kpi.entries.map((e) => Number(e.value)).reverse();
            return (
              <article
                key={kpi.id}
                className={`kpi-tile${openKpiId === kpi.id ? ' kpi-tile-open' : ''}`}
                onClick={() => setOpenKpiId(openKpiId === kpi.id ? null : kpi.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setOpenKpiId(kpi.id)}
              >
                <header>
                  <span className="kpi-code">{kpi.code}</span>
                  <h3>{kpi.name}</h3>
                </header>
                <p className="kpi-value">
                  {latest ? Number(latest.value).toLocaleString() : '—'}
                  <span className="kpi-unit"> {kpi.unit}</span>
                </p>
                <Sparkline values={series} label={`${kpi.name}, last ${series.length} periods`} />
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

      {openKpi && (
        <section className="kpi-detail" aria-label={`${openKpi.name} trend`}>
          <h2>
            {openKpi.name} <span className="muted">({openKpi.unit}, {openKpi.cadence})</span>
          </h2>
          {openKpi.entries.length < 2 ? (
            <p className="muted">not enough entries yet to draw a trend.</p>
          ) : (
            <KpiChart
              points={openKpi.entries
                .slice()
                .reverse()
                .map((e) => ({
                  period: new Date(e.periodStart).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  }),
                  value: Number(e.value),
                }))}
              target={openKpi.target !== null ? Number(openKpi.target) : null}
              unit={openKpi.unit}
            />
          )}
        </section>
      )}
    </PortalShell>
  );
}

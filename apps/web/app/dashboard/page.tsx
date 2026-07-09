'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import { PortalShell } from '../../components/portal-shell';
import { KpiDetailDrawer, DrawerKpi } from '../../components/kpi-detail-drawer';
import { api, downloadCsv } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import {
  STATUS_ICON,
  STATUS_LABEL,
  STATUS_ORDER,
  StatusKey,
  attainmentOf,
  statusOf,
} from '../../lib/kpi-status';

// Lazy-loaded: recharts only ships once the dashboard actually renders a chart.
const KpiDistributionChart = dynamic(() => import('../../components/kpi-distribution-chart'), {
  ssr: false,
  loading: () => <p className="muted">loading chart…</p>,
});

interface RawKpi {
  id: string;
  code: string;
  name: string;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  target: string | null;
  cadence: string;
  entries: Array<{ value: string; periodStart: string; periodEnd: string }>;
}

interface ComputedKpi extends RawKpi {
  attainment: number | null;
  status: StatusKey;
  latestValue: number | null;
}

type SortKey = 'code' | 'name' | 'cadence' | 'latestValue' | 'status' | 'updated';

const CADENCE_LABEL: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };

function computeKpi(kpi: RawKpi): ComputedKpi {
  const attainment = attainmentOf(kpi);
  const latest = kpi.entries[0];
  return {
    ...kpi,
    attainment,
    status: statusOf(attainment),
    latestValue: latest ? Number(latest.value) : null,
  };
}

export default function DashboardPage() {
  const user = useSession();
  const [kpis, setKpis] = useState<ComputedKpi[] | null>(null);
  const [level, setLevel] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'latestValue', dir: -1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (user) void api<RawKpi[]>('/v1/kpis/my').then((raw) => setKpis(raw.map(computeKpi)));
  }, [user]);

  const levelData = useMemo(() => {
    if (!kpis) return [];
    return level === 'all' ? kpis : kpis.filter((k) => k.cadence === level);
  }, [kpis, level]);

  const stats = useMemo(() => {
    const counts: Record<StatusKey, number> = { exceed: 0, high: 0, track: 0, improve: 0, critical: 0, pending: 0 };
    levelData.forEach((k) => counts[k.status]++);
    return counts;
  }, [levelData]);

  const tableData = useMemo(() => {
    let data = statusFilter === 'all' ? levelData : levelData.filter((k) => k.status === statusFilter);
    data = [...data].sort((a, b) => {
      const dir = sort.dir;
      switch (sort.key) {
        case 'code':
          return a.code.localeCompare(b.code) * dir;
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'cadence':
          return a.cadence.localeCompare(b.cadence) * dir;
        case 'status':
          return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) * dir;
        case 'updated': {
          const au = a.entries[0]?.periodEnd ?? '';
          const bu = b.entries[0]?.periodEnd ?? '';
          return au.localeCompare(bu) * dir;
        }
        case 'latestValue':
        default: {
          const av = a.latestValue;
          const bv = b.latestValue;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
      }
    });
    return data;
  }, [levelData, statusFilter, sort]);

  const levels = useMemo(() => {
    if (!kpis) return [];
    return [...new Set(kpis.map((k) => k.cadence))].sort();
  }, [kpis]);

  const distributionData = useMemo(() => {
    const groups = level === 'all' ? levels : [level];
    return groups.map((g) => {
      const inGroup = (kpis ?? []).filter((k) => k.cadence === g);
      return {
        level: CADENCE_LABEL[g] ?? g,
        exceed: inGroup.filter((k) => k.status === 'exceed').length,
        high: inGroup.filter((k) => k.status === 'high').length,
        track: inGroup.filter((k) => k.status === 'track').length,
        improve: inGroup.filter((k) => k.status === 'improve').length,
        critical: inGroup.filter((k) => k.status === 'critical').length,
      };
    });
  }, [kpis, level, levels]);

  const areaBars = useMemo(
    () =>
      [...levelData]
        .filter((k) => k.attainment !== null)
        .sort((a, b) => (b.attainment ?? 0) - (a.attainment ?? 0))
        .slice(0, 8),
    [levelData],
  );

  function sortBy(key: SortKey) {
    setSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  function onExportCsv() {
    const header = ['code', 'name', 'cadence', 'unit', 'latest', 'target', 'attainment_pct', 'status', 'last_period'];
    const rows = tableData.map((k) => [
      k.code,
      k.name,
      k.cadence,
      k.unit,
      k.latestValue ?? '',
      k.target ?? '',
      k.attainment !== null ? Math.round(k.attainment * 100) : '',
      STATUS_LABEL[k.status],
      k.entries[0]?.periodEnd ?? '',
    ]);
    downloadCsv('kpi-dashboard-export.csv', [header, ...rows]);
  }

  const selected = kpis?.find((k) => k.id === selectedId) ?? null;
  const drawerKpi: DrawerKpi | null = selected
    ? {
        id: selected.id,
        code: selected.code,
        name: selected.name,
        unit: selected.unit,
        cadence: CADENCE_LABEL[selected.cadence] ?? selected.cadence,
        target: selected.target !== null ? Number(selected.target) : null,
        latestValue: selected.latestValue,
        attainment: selected.attainment,
        status: selected.status,
        periods: [...selected.entries]
          .reverse()
          .map((e) => ({
            label: new Date(e.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            value: Number(e.value),
          })),
      }
    : null;

  const levelLabel = level === 'all' ? 'all cadences' : CADENCE_LABEL[level] ?? level;

  const sidebarExtra = kpis && (
    <>
      <div className="p-sidebar-section">levels</div>
      <div className="p-sidebar-levels">
        <button className={`p-ltab${level === 'all' ? ' active' : ''}`} onClick={() => setLevel('all')}>
          <span>all levels</span>
          <span className="p-ltab-badge">{kpis.length}</span>
        </button>
        {levels.map((l) => (
          <button key={l} className={`p-ltab${level === l ? ' active' : ''}`} onClick={() => setLevel(l)}>
            <span>{CADENCE_LABEL[l] ?? l}</span>
            <span className="p-ltab-badge">{kpis.filter((k) => k.cadence === l).length}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <PortalShell
      user={user}
      title="KPI overview"
      subtitle={`${levelLabel} · click any card or row for details`}
      sidebarExtra={sidebarExtra}
      actions={
        <button className="p-theme-toggle" onClick={onExportCsv}>
          Export CSV
        </button>
      }
    >
      {kpis === null ? (
        <p className="muted">loading…</p>
      ) : kpis.length === 0 ? (
        <div className="empty-state">
          <h2>no KPIs assigned yet</h2>
          <p className="muted">an admin can map KPIs to your role or department under KPI settings.</p>
        </div>
      ) : (
        <>
          <div className="p-kpi-strip">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                className={`p-kpi-card p-status-${s}${statusFilter === s ? ' active' : ''}`}
                onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              >
                <div className="p-kpi-icon">{STATUS_ICON[s]}</div>
                <div className="p-kpi-label">{STATUS_LABEL[s]}</div>
                <div className="p-kpi-val">{stats[s]}</div>
                <div className="p-kpi-sub">
                  {s === 'pending' ? 'no entries yet' : `${levelData.length ? Math.round((stats[s] / levelData.length) * 100) : 0}% of KPIs`}
                </div>
              </button>
            ))}
          </div>

          <div className="p-charts-row">
            <div className="p-card">
              <div className="p-card-title">KPI status by cadence</div>
              <KpiDistributionChart
                data={distributionData}
                textColor="var(--text-3)"
                gridColor="var(--border)"
              />
              <div className="p-legend-row">
                <div className="p-legend-item"><span className="p-legend-dot" style={{ background: '#a855f7' }} />Exceed</div>
                <div className="p-legend-item"><span className="p-legend-dot" style={{ background: '#22c55e' }} />High performer</div>
                <div className="p-legend-item"><span className="p-legend-dot" style={{ background: '#3b82f6' }} />On track</div>
                <div className="p-legend-item"><span className="p-legend-dot" style={{ background: '#f59e0b' }} />Needs improvement</div>
                <div className="p-legend-item"><span className="p-legend-dot" style={{ background: '#ef4444' }} />Critical</div>
              </div>
            </div>

            <div className="p-card">
              <div className="p-card-title">KPI attainment — click a bar</div>
              {areaBars.length === 0 ? (
                <p className="muted" style={{ fontSize: 12 }}>no scored KPIs in this view yet.</p>
              ) : (
                areaBars.map((k) => (
                  <button key={k.id} className="p-bar-row" onClick={() => setSelectedId(k.id)} title={`open ${k.name}`}>
                    <span className="p-bar-label">{k.name}</span>
                    <span className="p-bar-track">
                      <span
                        className="p-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.round((k.attainment ?? 0) * 100))}%`,
                          background: `var(--${k.status === 'exceed' ? 'purple' : k.status === 'high' ? 'green' : k.status === 'track' ? 'blue' : k.status === 'improve' ? 'amber' : 'red'})`,
                        }}
                      />
                    </span>
                    <span className="p-bar-score">{Math.round((k.attainment ?? 0) * 100)}%</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div className="p-card-title">action overview — click to filter</div>
            <div className="p-rec-grid">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  className={`p-rec-card p-status-${s}`}
                  onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                >
                  <div className="p-rec-num">{stats[s]}</div>
                  <div className="p-rec-label">{STATUS_LABEL[s]}</div>
                  <div className="p-rec-sub">
                    {s === 'exceed' && 'beating target by 15%+'}
                    {s === 'high' && 'meeting or beating target'}
                    {s === 'track' && 'within 15% of target'}
                    {s === 'improve' && 'below target — monitor'}
                    {s === 'critical' && 'well below target'}
                    {s === 'pending' && 'no entries recorded'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="p-table-card">
            <div className="p-table-header">
              <div className="p-filter-pills">
                {(['all', ...STATUS_ORDER] as const).map((s) => (
                  <button
                    key={s}
                    className={`p-fpill${statusFilter === s ? ' active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'all' ? 'All' : STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                sort: {sort.key} {sort.dir > 0 ? '↑' : '↓'}
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="p-th-sortable" onClick={() => sortBy('code')}>code</th>
                  <th className="p-th-sortable" onClick={() => sortBy('name')}>name</th>
                  <th className="p-th-sortable" onClick={() => sortBy('cadence')}>cadence</th>
                  <th className="p-th-sortable" onClick={() => sortBy('latestValue')}>latest</th>
                  <th>status</th>
                  <th className="p-th-sortable" onClick={() => sortBy('updated')}>last updated</th>
                  <th>action</th>
                </tr>
              </thead>
              <tbody>
                {tableData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: 'center' }}>
                      no KPIs match this filter.
                    </td>
                  </tr>
                ) : (
                  tableData.map((k) => (
                    <tr key={k.id} onClick={() => setSelectedId(k.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>{k.code}</td>
                      <td style={{ fontWeight: 500 }}>{k.name}</td>
                      <td className="muted">{CADENCE_LABEL[k.cadence] ?? k.cadence}</td>
                      <td>
                        <span className={`p-score-ring p-status-${k.status}`}>
                          {k.latestValue !== null ? k.latestValue.toLocaleString() : '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`p-pill p-status-${k.status}`}>{STATUS_LABEL[k.status]}</span>
                      </td>
                      <td className="muted" style={{ fontFamily: 'var(--mono)' }}>
                        {k.entries[0] ? new Date(k.entries[0].periodEnd).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <button
                          className="p-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(k.id);
                          }}
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="p-table-footer">
              <span className="p-tf-count">
                showing {tableData.length} of {levelData.length} KPIs
              </span>
              <button className="btn-ghost" onClick={() => setStatusFilter('all')}>
                clear filters
              </button>
            </div>
          </div>
        </>
      )}

      <KpiDetailDrawer kpi={drawerKpi} onClose={() => setSelectedId(null)} />
    </PortalShell>
  );
}

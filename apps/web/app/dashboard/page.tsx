'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import { PortalShell } from '../../components/portal-shell';
import { KpiDetailDrawer, DrawerKpi } from '../../components/kpi-detail-drawer';
import { api, downloadCsv } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import { STATUS_ICON, STATUS_LABEL, STATUS_ORDER, StatusKey, statusOf } from '../../lib/kpi-status';

// Lazy-loaded: recharts only ships once the dashboard actually renders a chart.
const KpiDistributionChart = dynamic(() => import('../../components/kpi-distribution-chart'), {
  ssr: false,
  loading: () => <p className="muted">loading chart…</p>,
});

interface RawEntry {
  value: string | number;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  person: { id: string; displayName: string };
}

interface RawEvaluationArea {
  id: string;
  name: string;
  cadence: string;
  isActive: boolean;
  entries: RawEntry[];
}

interface RawKpi {
  id: string;
  name: string;
  isActive: boolean;
  evaluationAreas: RawEvaluationArea[];
}

interface ComputedKpi {
  id: string;
  name: string;
  isActive: boolean;
  areas: RawEvaluationArea[];
  /** average of each area's single most recent entry, blended across whoever was evaluated */
  latestValue: number | null;
  status: StatusKey;
  lastUpdated: string | null;
}

type SortKey = 'name' | 'latestValue' | 'status' | 'updated';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** Entries arrive ordered periodStart desc (see KpisService.listMine) — [0] is the latest. */
function latestEntryOf(area: RawEvaluationArea): RawEntry | null {
  return area.entries[0] ?? null;
}

function computeKpi(kpi: RawKpi): ComputedKpi {
  const latestByArea = kpi.evaluationAreas.map(latestEntryOf).filter((e): e is RawEntry => e !== null);
  const values = latestByArea.map((e) => Number(e.value));
  const latestValue = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
  const lastUpdated = latestByArea.map((e) => e.periodEnd).sort().at(-1) ?? null;
  return {
    id: kpi.id,
    name: kpi.name,
    isActive: kpi.isActive,
    areas: kpi.evaluationAreas,
    latestValue,
    status: statusOf(latestValue),
    lastUpdated,
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

  // cadence now lives on each Evaluation Area (a KPI can span several) — "level" filters
  // to KPIs that have at least one area on that cadence, rather than a single KPI-wide value
  const levels = useMemo(() => {
    if (!kpis) return [];
    return [...new Set(kpis.flatMap((k) => k.areas.map((a) => a.cadence)))].sort();
  }, [kpis]);

  const levelData = useMemo(() => {
    if (!kpis) return [];
    return level === 'all' ? kpis : kpis.filter((k) => k.areas.some((a) => a.cadence === level));
  }, [kpis, level]);

  const stats = useMemo(() => {
    const counts: Record<StatusKey, number> = { outstanding: 0, meets: 0, improve: 0, below: 0, pending: 0 };
    levelData.forEach((k) => counts[k.status]++);
    return counts;
  }, [levelData]);

  const tableData = useMemo(() => {
    let data = statusFilter === 'all' ? levelData : levelData.filter((k) => k.status === statusFilter);
    data = [...data].sort((a, b) => {
      const dir = sort.dir;
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'status':
          return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) * dir;
        case 'updated':
          return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '') * dir;
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

  // "KPI status by cadence": groups EVALUATION AREAS (not KPIs — a KPI can span
  // several cadences) by their own cadence, stacking each area's latest status.
  const areaStatuses = useMemo(
    () =>
      levelData.flatMap((k) =>
        k.areas.map((a) => {
          const latest = latestEntryOf(a);
          return { cadence: a.cadence, status: statusOf(latest ? Number(latest.value) : null) };
        }),
      ),
    [levelData],
  );

  const distributionData = useMemo(() => {
    const groups = level === 'all' ? levels : [level];
    return groups.map((g) => {
      const inGroup = areaStatuses.filter((a) => a.cadence === g);
      return {
        level: CADENCE_LABEL[g] ?? g,
        outstanding: inGroup.filter((a) => a.status === 'outstanding').length,
        meets: inGroup.filter((a) => a.status === 'meets').length,
        improve: inGroup.filter((a) => a.status === 'improve').length,
        below: inGroup.filter((a) => a.status === 'below').length,
      };
    });
  }, [areaStatuses, level, levels]);

  const hasDistributionData = distributionData.some((g) => g.outstanding + g.meets + g.improve + g.below > 0);

  // "KPI by Person": each distinct evaluatee's own average latest score → status,
  // stacked into the same 4-tier bars as the cadence chart above (same component,
  // just grouped by person instead of cadence).
  const byPersonData = useMemo(() => {
    const byPerson = new Map<string, { name: string; values: number[] }>();
    for (const kpi of levelData) {
      for (const area of kpi.areas) {
        const latest = latestEntryOf(area);
        if (!latest) continue;
        const entry = byPerson.get(latest.person.id) ?? { name: latest.person.displayName, values: [] };
        entry.values.push(Number(latest.value));
        byPerson.set(latest.person.id, entry);
      }
    }
    return [...byPerson.values()].map(({ name, values }) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const status = statusOf(avg);
      return {
        level: name,
        outstanding: status === 'outstanding' ? 1 : 0,
        meets: status === 'meets' ? 1 : 0,
        improve: status === 'improve' ? 1 : 0,
        below: status === 'below' ? 1 : 0,
      };
    });
  }, [levelData]);

  const hasByPersonData = byPersonData.length > 0;

  function sortBy(key: SortKey) {
    setSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  function onExportCsv() {
    const header = ['name', 'evaluation_areas', 'latest', 'status', 'last_updated'];
    const rows = tableData.map((k) => [
      k.name,
      String(k.areas.length),
      k.latestValue ?? '',
      STATUS_LABEL[k.status],
      k.lastUpdated ?? '',
    ]);
    downloadCsv('kpi-dashboard-export.csv', [header, ...rows]);
  }

  const selected = kpis?.find((k) => k.id === selectedId) ?? null;
  const drawerKpi: DrawerKpi | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        status: selected.status,
        areas: selected.areas.map((a) => ({
          id: a.id,
          name: a.name,
          cadence: CADENCE_LABEL[a.cadence] ?? a.cadence,
          latestValue: latestEntryOf(a) ? Number(latestEntryOf(a)!.value) : null,
          entries: [...a.entries].reverse().map((e) => ({
            label: new Date(e.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            value: Number(e.value),
            personName: e.person.displayName,
          })),
        })),
      }
    : null;

  const levelLabel = level === 'all' ? 'all cadences' : CADENCE_LABEL[level] ?? level;

  return (
    <PortalShell user={user}>
      <div className="p-dashboard">
        <div className="page-title-row">
          <div>
            <h1>KPI dashboard</h1>
            <p className="portal-subtitle" style={{ margin: '4px 0 0' }}>
              {levelLabel} · click any card or row for details
            </p>
          </div>
          <span className="builder-field-actions">
            <button className="p-theme-toggle" onClick={onExportCsv}>
              Export CSV
            </button>
          </span>
        </div>

        {kpis && (
          <div className="p-filter-pills" style={{ marginBottom: 20 }}>
            <button className={`p-fpill${level === 'all' ? ' active' : ''}`} onClick={() => setLevel('all')}>
              all levels ({kpis.length})
            </button>
            {levels.map((l) => (
              <button key={l} className={`p-fpill${level === l ? ' active' : ''}`} onClick={() => setLevel(l)}>
                {CADENCE_LABEL[l] ?? l} ({kpis.filter((k) => k.areas.some((a) => a.cadence === l)).length})
              </button>
            ))}
          </div>
        )}

        {kpis === null ? (
          <div className="skeleton-card" aria-hidden="true">
            <div className="skeleton-line" style={{ width: '50%' }} />
            <div className="skeleton-line" style={{ width: '70%' }} />
            <div className="skeleton-line" style={{ width: '40%' }} />
          </div>
        ) : (
          <>
            {kpis.length === 0 && (
              <p className="muted" style={{ marginBottom: 12 }}>
                no KPIs assigned yet — an admin can map KPIs to your role or department under KPI settings. the
                widgets below will fill in as soon as one is.
              </p>
            )}
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
                {hasDistributionData ? (
                  <>
                    <KpiDistributionChart
                      data={distributionData}
                      textColor="var(--text-3)"
                      gridColor="var(--border)"
                    />
                    <div className="p-legend-row">
                      <div className="p-legend-item"><span className="p-legend-dot" style={{ background: 'var(--purple)' }} />Outstanding</div>
                      <div className="p-legend-item"><span className="p-legend-dot" style={{ background: 'var(--green)' }} />Meet expectations</div>
                      <div className="p-legend-item"><span className="p-legend-dot" style={{ background: 'var(--amber)' }} />Needs improvement</div>
                      <div className="p-legend-item"><span className="p-legend-dot" style={{ background: 'var(--red)' }} />Below expectations</div>
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>no scored KPIs in this view yet.</p>
                )}
              </div>

              <div className="p-card">
                <div className="p-card-title">KPI by Person</div>
                {hasByPersonData ? (
                  <KpiDistributionChart
                    data={byPersonData}
                    textColor="var(--text-3)"
                    gridColor="var(--border)"
                  />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>no scored KPIs in this view yet.</p>
                )}
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
                    <th
                      className="p-th-sortable"
                      aria-sort={sort.key === 'name' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('name')}>
                        name
                      </button>
                    </th>
                    <th>areas</th>
                    <th
                      className="p-th-sortable"
                      aria-sort={sort.key === 'latestValue' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('latestValue')}>
                        latest
                      </button>
                    </th>
                    <th>status</th>
                    <th
                      className="p-th-sortable"
                      aria-sort={sort.key === 'updated' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('updated')}>
                        last updated
                      </button>
                    </th>
                    <th>action</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                        {kpis.length === 0 ? 'no KPIs assigned yet.' : 'no KPIs match this filter.'}
                      </td>
                    </tr>
                  ) : (
                    tableData.map((k) => (
                      <tr
                        key={k.id}
                        tabIndex={0}
                        role="button"
                        aria-label={`view ${k.name}`}
                        onClick={() => setSelectedId(k.id)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedId(k.id);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ fontWeight: 500 }}>{k.name}</td>
                        <td className="muted">{k.areas.length}</td>
                        <td>
                          <span className={`p-score-ring p-status-${k.status}`}>
                            {k.latestValue !== null ? k.latestValue.toLocaleString() : '—'}
                          </span>
                        </td>
                        <td>
                          <span className={`p-pill p-status-${k.status}`}>{STATUS_LABEL[k.status]}</span>
                        </td>
                        <td className="muted" style={{ fontFamily: 'var(--mono)' }}>
                          {k.lastUpdated ? new Date(k.lastUpdated).toLocaleDateString() : '—'}
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
      </div>
    </PortalShell>
  );
}

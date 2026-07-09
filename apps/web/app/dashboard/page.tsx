'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';
import { useEffect } from 'react';
import { PortalShell } from '../../components/portal-shell';
import { KpiDetailDrawer, DrawerKpi } from '../../components/kpi-detail-drawer';
import { api, downloadCsv } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import type { RawKpi } from '../../lib/parse-kpi-workbook';
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

interface ComputedKpi extends RawKpi {
  attainment: number | null;
  status: StatusKey;
  latestValue: number | null;
}

type SortKey = 'code' | 'name' | 'cadence' | 'latestValue' | 'status' | 'updated';

const CADENCE_LABEL: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };

// persisted across reloads until the user imports a different file or resets —
// stored as raw parsed rows (not the computed/derived fields) so it stays
// correct even if the status/attainment logic changes later
const UPLOAD_STORAGE_KEY = 'pulse:dashboard:uploaded-kpis';

interface StoredUpload {
  filename: string;
  rawKpis: RawKpi[];
  issues: string[];
}

function loadStoredUpload(): StoredUpload | null {
  try {
    const raw = window.localStorage.getItem(UPLOAD_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredUpload) : null;
  } catch {
    return null;
  }
}

function computeKpi(kpi: RawKpi): ComputedKpi {
  const latest = kpi.entries[0];
  const latestValue = latest ? Number(latest.value) : null;
  return {
    ...kpi,
    attainment: attainmentOf(kpi),
    status: statusOf(latestValue),
    latestValue,
  };
}

export default function DashboardPage() {
  const user = useSession();
  const [liveKpis, setLiveKpis] = useState<ComputedKpi[] | null>(null);
  const [uploaded, setUploaded] = useState<{ filename: string; kpis: ComputedKpi[]; issues: string[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [level, setLevel] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'latestValue', dir: -1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const kpis = uploaded ? uploaded.kpis : liveKpis;

  useEffect(() => {
    if (user) void api<RawKpi[]>('/v1/kpis/my').then((raw) => setLiveKpis(raw.map(computeKpi)));
  }, [user]);

  // restore a previously-uploaded sheet on reload — stays active until the
  // user imports a different file or resets, independent of the live API data
  useEffect(() => {
    const stored = loadStoredUpload();
    if (stored) {
      setUploaded({ filename: stored.filename, kpis: stored.rawKpis.map(computeKpi), issues: stored.issues });
    }
  }, []);

  async function handleFile(file: File) {
    if (!/\.xlsx?$/i.test(file.name)) {
      setUploadError('please choose an .xlsx or .xls file');
      return;
    }
    setUploadError(null);
    setParsing(true);
    try {
      // lazy-loaded: the xlsx parsing engine only ships once someone actually imports a file
      const { parseKpiWorkbook } = await import('../../lib/parse-kpi-workbook');
      const { kpis: parsedKpis, issues } = await parseKpiWorkbook(file);
      if (parsedKpis.length === 0) {
        setUploadError(
          issues[0] ?? 'no usable rows found — check that the sheet has Code, Name, and Value columns',
        );
        return;
      }
      window.localStorage.setItem(
        UPLOAD_STORAGE_KEY,
        JSON.stringify({ filename: file.name, rawKpis: parsedKpis, issues }),
      );
      setUploaded({ filename: file.name, kpis: parsedKpis.map(computeKpi), issues });
      setLevel('all');
      setStatusFilter('all');
      setShowImportModal(false);
    } catch {
      setUploadError('could not read this file — is it a valid .xlsx spreadsheet?');
    } finally {
      setParsing(false);
    }
  }

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file after fixing it
    if (file) void handleFile(file);
  }

  function onDropFile(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onUseLiveData() {
    window.localStorage.removeItem(UPLOAD_STORAGE_KEY);
    setUploaded(null);
    setUploadError(null);
    setLevel('all');
    setStatusFilter('all');
    setShowImportModal(false);
  }

  const levelData = useMemo(() => {
    if (!kpis) return [];
    return level === 'all' ? kpis : kpis.filter((k) => k.cadence === level);
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
        outstanding: inGroup.filter((k) => k.status === 'outstanding').length,
        meets: inGroup.filter((k) => k.status === 'meets').length,
        improve: inGroup.filter((k) => k.status === 'improve').length,
        below: inGroup.filter((k) => k.status === 'below').length,
      };
    });
  }, [kpis, level, levels]);

  const hasDistributionData = distributionData.some(
    (g) => g.outstanding + g.meets + g.improve + g.below > 0,
  );

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
            <button className="p-theme-toggle" onClick={() => setShowImportModal(true)}>
              {uploaded ? `📄 ${uploaded.filename}` : 'Import spreadsheet'}
            </button>
            <button className="p-theme-toggle" onClick={onExportCsv}>
              Export CSV
            </button>
          </span>
        </div>

        {showImportModal && (
          <div className="response-modal-backdrop" onClick={() => setShowImportModal(false)}>
            <div
              className="response-modal-card"
              role="dialog"
              aria-modal="true"
              aria-label="import spreadsheet"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="response-modal-header">
                <h2>Import spreadsheet</h2>
                <button className="btn-ghost" onClick={() => setShowImportModal(false)} aria-label="close">
                  close
                </button>
              </div>
              <div className="response-modal-body">
                {uploaded && (
                  <div className="import-status-card">
                    <span className="import-status-icon">📄</span>
                    <span className="import-status-text">
                      <strong>{uploaded.filename}</strong>
                      <span className="muted">
                        {uploaded.kpis.length} KPI{uploaded.kpis.length === 1 ? '' : 's'} imported
                        {uploaded.issues.length > 0 &&
                          ` · ${uploaded.issues.length} row${uploaded.issues.length === 1 ? '' : 's'} skipped`}
                      </span>
                    </span>
                    <button className="btn-ghost import-reset-btn" onClick={onUseLiveData}>
                      reset
                    </button>
                  </div>
                )}

                {uploaded && uploaded.issues.length > 0 && (
                  <ul className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    {uploaded.issues.slice(0, 5).map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                    {uploaded.issues.length > 5 && <li>…and {uploaded.issues.length - 5} more</li>}
                  </ul>
                )}

                <p className="muted" style={{ fontSize: 12, margin: uploaded ? '18px 0 8px' : '0 0 8px' }}>
                  {uploaded ? 'replace it with a different spreadsheet' : 'no spreadsheet imported — showing live KPI data'}
                </p>

                <div
                  className={`import-dropzone${dragOver ? ' import-dropzone-active' : ''}${parsing ? ' import-dropzone-busy' : ''}`}
                  onClick={() => !parsing && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDropFile}
                  role="button"
                  tabIndex={0}
                  aria-label="upload a spreadsheet"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                  <input
                    id="dashboard-import-file"
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={onFileSelected}
                    disabled={parsing}
                    style={{ display: 'none' }}
                  />
                  {parsing ? (
                    <span>reading file…</span>
                  ) : (
                    <>
                      <span className="import-dropzone-icon">⬆</span>
                      <span><strong>click to browse</strong> or drag a spreadsheet here</span>
                      <span className="muted" style={{ fontSize: 12 }}>.xlsx or .xls</span>
                    </>
                  )}
                </div>

                {uploadError && (
                  <p role="alert" className="form-error" style={{ marginTop: 12 }}>
                    {uploadError}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {kpis && kpis.length > 0 && (
          <div className="p-filter-pills" style={{ marginBottom: 20 }}>
            <button className={`p-fpill${level === 'all' ? ' active' : ''}`} onClick={() => setLevel('all')}>
              all levels ({kpis.length})
            </button>
            {levels.map((l) => (
              <button key={l} className={`p-fpill${level === l ? ' active' : ''}`} onClick={() => setLevel(l)}>
                {CADENCE_LABEL[l] ?? l} ({kpis.filter((k) => k.cadence === l).length})
              </button>
            ))}
          </div>
        )}

        {kpis === null ? (
          <p className="muted">loading…</p>
        ) : kpis.length === 0 ? (
          <div className="empty-state">
            <h2>no KPIs {uploaded ? 'in this file' : 'assigned yet'}</h2>
            <p className="muted">
              {uploaded
                ? 'the uploaded spreadsheet had no usable rows — check it has Code, Name, and Value columns.'
                : 'an admin can map KPIs to your role or department under KPI settings, or import a spreadsheet above.'}
            </p>
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
                            background: `var(--${k.status === 'outstanding' ? 'purple' : k.status === 'meets' ? 'green' : k.status === 'improve' ? 'amber' : 'red'})`,
                          }}
                        />
                      </span>
                      <span className="p-bar-score">{Math.round((k.attainment ?? 0) * 100)}%</span>
                    </button>
                  ))
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
                    <th className="p-th-sortable" onClick={() => sortBy('name')}>name</th>
                    <th>title</th>
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
                        <td style={{ fontWeight: 500 }}>{k.name}</td>
                        <td className="muted">{k.title ?? '—'}</td>
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
      </div>
    </PortalShell>
  );
}

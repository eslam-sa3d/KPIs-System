import { FormEvent } from 'react';
import { Plus, Search, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AssignToField, WeightRing, pluralize } from './kpi-widgets';
import type { DepartmentOption, KpiRow } from './types';

/** Left-hand sidebar: search-filtered KPI list plus the inline "create KPI"
 *  form. Selecting a row hands off to the detail pane via `selectedKpiId`. */
export function KpiListPane({
  canWrite,
  creatingKpi,
  setCreatingKpi,
  onCreateKpi,
  departments,
  filteredKpis,
  search,
  selectedKpiId,
  setSelectedKpiId,
}: {
  canWrite: boolean;
  creatingKpi: boolean;
  setCreatingKpi: (value: boolean) => void;
  onCreateKpi: (event: FormEvent<HTMLFormElement>) => void;
  departments: DepartmentOption[];
  filteredKpis: KpiRow[] | null;
  search: string;
  selectedKpiId: string | null;
  setSelectedKpiId: (id: string | null) => void;
}) {
  return (
    <div className="kpi-list-pane">
      {canWrite &&
        (creatingKpi ? (
          <form className="inline-form" onSubmit={(e) => onCreateKpi(e)}>
            <Input name="name" required minLength={2} placeholder="New KPI name" aria-label="KPI name" autoFocus />
            <Input
              name="weight"
              type="number"
              min={0}
              max={100}
              step="0.5"
              placeholder="Weight %"
              aria-label="Weight percent"
            />
            <AssignToField departments={departments} />
            <Button type="submit">Create</Button>
            <Button type="button" variant="ghost" onClick={() => setCreatingKpi(false)}>
              Close
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => setCreatingKpi(true)}
          >
            <Plus size={16} aria-hidden="true" />
            New KPI
          </Button>
        ))}

      {filteredKpis && filteredKpis.length === 0 ? (
        <p className="empty-state-inline">
          <Search size={14} aria-hidden="true" />
          No KPIs match &quot;{search}&quot;
        </p>
      ) : (
        <div className="kpi-list-items">
          {filteredKpis?.map((kpi) => (
            <button
              key={kpi.id}
              type="button"
              className={`kpi-list-item${selectedKpiId === kpi.id ? ' is-selected' : ''}`}
              aria-current={selectedKpiId === kpi.id ? 'true' : undefined}
              onClick={() => setSelectedKpiId(kpi.id)}
            >
              {kpi.weight !== null ? (
                <WeightRing value={kpi.weight} size="sm" />
              ) : (
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <Target size={14} aria-hidden="true" />
                </span>
              )}
              <span className="kpi-list-item-body">
                <span className="kpi-list-item-name">{kpi.name}</span>
                <span className="kpi-list-item-meta">
                  {!kpi.isActive && (
                    <span
                      className="size-[7px] shrink-0 rounded-full"
                      style={{ background: 'var(--color-text-muted)' }}
                      aria-hidden="true"
                    />
                  )}
                  {pluralize(kpi.evaluationAreas.length, 'area')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DepartmentOption } from './types';

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** M3-style conic-gradient dial showing a 0-100 weight at a glance instead
 *  of burying it in a run of muted text. */
export function WeightRing({ value, size = 'md' }: { value: number; size?: 'md' | 'sm' }) {
  return (
    <span
      className={`weight-ring${size === 'sm' ? ' weight-ring-sm' : ''}`}
      style={{ '--ring-pct': `${Math.min(100, Math.max(0, value))}%` } as React.CSSProperties}
      role="img"
      aria-label={`Weight ${value}%`}
    >
      <span className="weight-ring-value" aria-hidden="true">
        {value}
      </span>
    </span>
  );
}

/** Toggles isActive via the same PATCH every level already uses — styled as
 *  a status pill (dot + label) instead of a text button whose label is
 *  always the opposite of the current state ("deactivate" while active). */
export function StatusPill({
  isActive,
  onToggle,
  size,
  disabled,
}: {
  isActive: boolean;
  onToggle: () => void;
  size?: 'sm';
  /** Renders the badge read-only (status still visible) when the caller lacks
   *  kpis:activate_deactivate — showing status shouldn't require edit rights. */
  disabled?: boolean;
}) {
  return (
    <Badge asChild variant="outline" className={size === 'sm' ? 'gap-1.5 py-0.5 text-xs' : 'gap-1.5 py-1'}>
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className={isActive ? '' : 'text-muted-foreground'}
      >
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: isActive ? 'var(--color-success)' : 'var(--color-text-muted)' }}
          aria-hidden="true"
        />
        {isActive ? 'Active' : 'Inactive'}
      </button>
    </Badge>
  );
}

export function LoadingRows() {
  return (
    <div className="rounded-md border bg-card mt-4 mb-6 p-6" style={{ display: 'flex', justifyContent: 'center' }}>
      <Spinner className="size-6" />
    </div>
  );
}

/** Shared department picker for the KPI-creation forms — folds the default
 *  department assignment into creation itself, instead of leaving a
 *  brand-new KPI invisible on every dashboard until an admin makes a
 *  separate follow-up trip to the assignment UI below. */
// Radix Select renders a hidden native <select> in sync with its value when
// given a `name`, so this still participates in the surrounding form's
// FormData on submit exactly like the native <select> it replaces.
export function AssignToField({ departments }: { departments: DepartmentOption[] }) {
  return (
    <Select name="assignTo">
      <SelectTrigger aria-label="Department (optional)">
        <SelectValue placeholder="Department (optional)…" />
      </SelectTrigger>
      <SelectContent>
        {departments.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

import { Badge } from '@/components/ui/badge';

/** Dot + label pill for a passive active/inactive-style indicator — reused
 *  across forms/KPI lists (e.g. "open"/"closed", "active"/"inactive",
 *  "archived"). For a *clickable* toggle, see admin/kpis/page.tsx's own
 *  StatusPill (uses Lozenge's own onClick/isSelected instead). */
export function StatusBadge({
  active,
  label,
}: {
  active: boolean;
  label: string;
  size?: 'default' | 'sm';
}) {
  return (
    <Badge variant="outline">
      <span
        style={{
          width: 7,
          height: 7,
          flexShrink: 0,
          borderRadius: '50%',
          background: active ? 'var(--color-success)' : 'var(--color-text-muted)',
          display: 'inline-block',
          marginRight: 6,
        }}
        aria-hidden="true"
      />
      {label}
    </Badge>
  );
}

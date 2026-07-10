import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Dot + label pill for a passive active/inactive-style indicator — reused
 *  across forms/KPI lists (e.g. "open"/"closed", "active"/"inactive",
 *  "archived"). For a *clickable* toggle, see admin/kpis/page.tsx's own
 *  StatusPill (wraps a real <button> via Badge's asChild). */
export function StatusBadge({
  active,
  label,
  size = 'default',
}: {
  active: boolean;
  label: string;
  size?: 'default' | 'sm';
}) {
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5', size === 'sm' ? 'py-0.5 text-xs' : 'py-1', !active && 'text-muted-foreground')}
    >
      <span
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: active ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        aria-hidden="true"
      />
      {label}
    </Badge>
  );
}

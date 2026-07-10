import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const baseClasses =
  'flex flex-row items-center gap-4 rounded-xl border bg-card p-4 text-left text-card-foreground shadow-sm';

/** A shadcn Card composition for a compact icon + number + label tile —
 *  the row of KPI/form counts shown above the KPIs and Forms list pages.
 *  Renders as a <button> (with hover/focus treatment) when onClick is
 *  given, otherwise a plain <div>, since shadcn's own Card has no
 *  polymorphic/asChild support. */
export function StatCard({
  icon,
  value,
  label,
  tone = 'default',
  onClick,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tone?: 'default' | 'accent';
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon}
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong
          className={cn('text-2xl font-bold leading-none', tone === 'accent' ? 'text-destructive' : 'text-primary')}
        >
          {value}
        </strong>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
    </>
  );

  const toneClasses = tone === 'accent' ? 'border-destructive/30 bg-destructive/10' : '';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          baseClasses,
          toneClasses,
          'cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {content}
      </button>
    );
  }

  return <div className={cn(baseClasses, toneClasses)}>{content}</div>;
}

/** Tinted square icon badge for a StatCard's leading visual. */
export function StatCardIcon({ icon, tone = 'default' }: { icon: ReactNode; tone?: 'default' | 'accent' }) {
  return (
    <div
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-lg',
        tone === 'accent' ? 'bg-card text-destructive' : 'bg-primary/10 text-primary',
      )}
    >
      {icon}
    </div>
  );
}

import * as React from 'react';

import { cn } from '@/lib/utils';

const ALERT_BASE =
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current';

const ALERT_VARIANT_CLASSES = {
  default: 'bg-card text-card-foreground',
  destructive: 'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current',
} as const;

type AlertVariant = keyof typeof ALERT_VARIANT_CLASSES;

function Alert({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & { variant?: AlertVariant }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(ALERT_BASE, ALERT_VARIANT_CLASSES[variant], className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription };

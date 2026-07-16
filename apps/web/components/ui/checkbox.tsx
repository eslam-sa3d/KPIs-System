'use client';

import * as React from 'react';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Checkbox({
  className,
  checked = false,
  onCheckedChange,
  disabled,
  id,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick' | 'children'> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={checked}
      data-slot="checkbox"
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'peer grid size-4 shrink-0 place-content-center rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      {checked && (
        <span data-slot="checkbox-indicator" className="grid place-content-center text-current transition-none">
          <CheckIcon className="size-3.5" />
        </span>
      )}
    </button>
  );
}

export { Checkbox };

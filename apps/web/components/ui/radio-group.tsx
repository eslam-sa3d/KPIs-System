'use client';

import * as React from 'react';
import { CircleIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const RadioGroupContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
} | null>(null);

const RADIO_ITEM_SELECTOR = '[role="radio"]:not(:disabled)';

function RadioGroup({
  className,
  value,
  onValueChange,
  ...props
}: React.ComponentProps<'div'> & {
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const context = React.useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Roving tabindex (WAI-ARIA radiogroup pattern): RadioGroupItem gives the
  // checked item the sole Tab stop and every other item -1. Until something
  // is checked there's no item to derive that from via props alone, so patch
  // the DOM directly once per value change — the first enabled item becomes
  // reachable instead of the whole group being untabbable.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || root.querySelector('[data-state="checked"]')) return;
    const first = root.querySelector<HTMLButtonElement>(RADIO_ITEM_SELECTOR);
    if (first) first.tabIndex = 0;
  }, [value]);

  // Arrow keys move focus AND selection together, matching native
  // <input type="radio"> group behavior — not just focus like a listbox.
  // Wraps at the ends; Home/End jump to the first/last enabled item.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(RADIO_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    event.preventDefault();

    const currentIndex = items.findIndex((el) => el === document.activeElement);
    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1 + items.length) % items.length;
    } else nextIndex = (currentIndex - 1 + items.length) % items.length;

    const next = items[nextIndex]!;
    next.focus();
    if (next.dataset.value !== undefined) onValueChange?.(next.dataset.value);
  }

  return (
    <RadioGroupContext.Provider value={context}>
      <div
        ref={rootRef}
        data-slot="radio-group"
        role="radiogroup"
        className={cn('grid gap-3', className)}
        onKeyDown={onKeyDown}
        {...props}
      />
    </RadioGroupContext.Provider>
  );
}

function RadioGroupItem({
  className,
  value,
  disabled,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick' | 'value' | 'children'> & {
  value: string;
}) {
  const context = React.useContext(RadioGroupContext);
  const checked = context?.value === value;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-slot="radio-group-item"
      data-state={checked ? 'checked' : 'unchecked'}
      data-value={value}
      disabled={disabled}
      tabIndex={checked ? 0 : -1}
      onClick={() => context?.onValueChange?.(value)}
      className={cn(
        'aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      {checked && (
        <span data-slot="radio-group-indicator" className="relative flex items-center justify-center">
          <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary" />
        </span>
      )}
    </button>
  );
}

export { RadioGroup, RadioGroupItem };

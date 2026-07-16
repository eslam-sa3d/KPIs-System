'use client';

import * as React from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/primitives/portal';
import { useAnchoredPosition } from '@/components/ui/primitives/use-anchored-position';
import { useControllableState } from '@/components/ui/primitives/use-controllable-state';
import { useDismissableLayer } from '@/components/ui/primitives/use-dismissable-layer';

/** `SelectSeparator`/`SelectScrollUpButton`/`SelectScrollDownButton` aren't
 *  implemented — no consumer uses them, and every list here is short enough
 *  that native overflow scrolling (no custom scroll buttons) is sufficient.
 *
 *  `SelectContent` stays mounted (visually hidden via the `hidden` attribute)
 *  even while closed, rather than unmounting — that's what lets each
 *  `SelectItem` register its rendered label into context on every render, so
 *  `SelectValue` can always resolve "what's the label for the current value"
 *  without needing Radix's internal value-caching machinery. */

const SelectContext = React.createContext<{
  value?: string;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  registerItem: (value: string, label: React.ReactNode) => () => void;
  labelFor: (value: string) => React.ReactNode | undefined;
  orderedValues: () => string[];
} | null>(null);

function useSelectContext() {
  const context = React.useContext(SelectContext);
  if (!context) throw new Error('Select.* must be rendered inside <Select>');
  return context;
}

function Select({
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** Renders a hidden `<input>` mirroring the current value, so this participates
   *  in the surrounding `<form>`'s `FormData` on submit like a native `<select>`. */
  name?: string;
  children?: React.ReactNode;
}) {
  const [current, setCurrent] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const itemsRef = React.useRef(new Map<string, React.ReactNode>());
  const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);

  const registerItem = React.useCallback((itemValue: string, label: React.ReactNode) => {
    itemsRef.current.set(itemValue, label);
    forceRerender();
    return () => {
      itemsRef.current.delete(itemValue);
      forceRerender();
    };
  }, []);

  const labelFor = React.useCallback((v: string) => itemsRef.current.get(v), []);
  const orderedValues = React.useCallback(() => Array.from(itemsRef.current.keys()), []);

  const setValue = React.useCallback(
    (v: string) => {
      setCurrent(v);
      setOpen(false);
    },
    [setCurrent],
  );

  const context = React.useMemo(
    () => ({
      value: current,
      setValue,
      open,
      setOpen,
      disabled,
      triggerRef,
      contentRef,
      registerItem,
      labelFor,
      orderedValues,
    }),
    [current, setValue, open, disabled, registerItem, labelFor, orderedValues],
  );

  return (
    <SelectContext.Provider value={context}>
      {name && <input type="hidden" name={name} value={current ?? ''} readOnly />}
      {children}
    </SelectContext.Provider>
  );
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<'button'> & { size?: 'sm' | 'default' }) {
  const { open, setOpen, disabled, triggerRef, setValue, labelFor, orderedValues } = useSelectContext();
  const typeaheadRef = React.useRef('');
  const typeaheadTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      typeaheadRef.current += event.key.toLowerCase();
      clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => {
        typeaheadRef.current = '';
      }, 500);
      const match = orderedValues().find((v) => {
        const label = labelFor(v);
        return typeof label === 'string' && label.toLowerCase().startsWith(typeaheadRef.current);
      });
      if (match !== undefined) setValue(match);
    }
  }

  return (
    <button
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      data-slot="select-trigger"
      data-size={size}
      ref={triggerRef as React.Ref<HTMLButtonElement>}
      onClick={() => setOpen(!open)}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="size-4 opacity-50" />
    </button>
  );
}

function SelectValue({ placeholder, className }: { placeholder?: React.ReactNode; className?: string }) {
  const { value, labelFor } = useSelectContext();
  const label = value !== undefined ? labelFor(value) : undefined;

  return (
    <span data-slot="select-value" className={cn('line-clamp-1 flex items-center gap-2', className)}>
      {label ?? <span className="text-muted-foreground">{placeholder}</span>}
    </span>
  );
}

const SELECT_ITEM_SELECTOR = '[role="option"]:not([aria-disabled="true"])';

function SelectContent({
  className,
  children,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'center' | 'end'; sideOffset?: number }) {
  const { open, setOpen, triggerRef, contentRef } = useSelectContext();
  const { style, side } = useAnchoredPosition({ open, triggerRef, contentRef, side: 'bottom', align, sideOffset });

  useDismissableLayer({ open, onDismiss: () => setOpen(false), contentRef, excludeRefs: [triggerRef] });

  React.useEffect(() => {
    if (!open) return;
    const selected = contentRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const first = contentRef.current?.querySelector<HTMLElement>(SELECT_ITEM_SELECTOR);
    (selected ?? first)?.focus();
  }, [open, contentRef]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(SELECT_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    else nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;

    items[nextIndex]?.focus();
  }

  return (
    <Portal>
      <div
        ref={contentRef}
        data-slot="select-content"
        data-side={side}
        role="listbox"
        hidden={!open}
        style={open ? style : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          'z-50 max-h-[70vh] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      >
        <div className="p-1">{children}</div>
      </div>
    </Portal>
  );
}

function SelectGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="select-group" role="group" className={className} {...props} />;
}

function SelectLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="select-label" className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)} {...props} />
  );
}

function SelectItem({
  className,
  children,
  value,
  disabled,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value'> & { value: string }) {
  const { value: selectedValue, setValue, registerItem } = useSelectContext();
  const selected = selectedValue === value;

  // Depends on `value` only, not `children` — `children` is a fresh element
  // reference on every render for non-text content, which would otherwise
  // re-run this effect (and its forceRerender) every single render.
  React.useEffect(() => registerItem(value, children), [value, registerItem]);

  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={disabled}
      data-slot="select-item"
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {selected && (
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
          <CheckIcon className="size-4" />
        </span>
      )}
      {children}
    </button>
  );
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue };

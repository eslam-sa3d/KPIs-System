'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { useControllableState } from '@/components/ui/primitives/use-controllable-state';

const TabsContext = React.createContext<{
  value?: string;
  setValue: (value: string) => void;
  orientation: 'horizontal' | 'vertical';
  baseId: string;
} | null>(null);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs.* must be rendered inside <Tabs>');
  return context;
}

function Tabs({
  className,
  orientation = 'horizontal',
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical';
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [current, setCurrent] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const baseId = React.useId();
  const context = React.useMemo(
    () => ({ value: current, setValue: setCurrent, orientation, baseId }),
    [current, setCurrent, orientation, baseId],
  );

  return (
    <TabsContext.Provider value={context}>
      <div
        data-slot="tabs"
        data-orientation={orientation}
        className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)}
        {...props}
      />
    </TabsContext.Provider>
  );
}

const TABS_LIST_VARIANT_CLASSES = {
  default: 'bg-muted',
  line: 'gap-1 bg-transparent',
} as const;

const TAB_TRIGGER_SELECTOR = '[role="tab"]:not(:disabled)';

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: keyof typeof TABS_LIST_VARIANT_CLASSES }) {
  const { orientation, setValue } = useTabsContext();
  const rootRef = React.useRef<HTMLDivElement>(null);

  // WAI-ARIA tabs pattern, automatic activation: arrow keys (matching the
  // list's orientation) move focus AND select the tab together, wrapping at
  // the ends; Home/End jump to the first/last enabled tab.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    if (![forward, backward, 'Home', 'End'].includes(event.key)) return;

    const tabs = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(TAB_TRIGGER_SELECTOR) ?? []);
    if (tabs.length === 0) return;
    event.preventDefault();

    const currentIndex = tabs.findIndex((el) => el === document.activeElement);
    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === forward) nextIndex = (currentIndex + 1 + tabs.length) % tabs.length;
    else nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;

    const next = tabs[nextIndex]!;
    next.focus();
    if (next.dataset.value !== undefined) setValue(next.dataset.value);
  }

  return (
    <div
      ref={rootRef}
      data-slot="tabs-list"
      data-variant={variant}
      role="tablist"
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cn(
        'group/tabs-list inline-flex w-fit items-center justify-center rounded-xl p-1 text-muted-foreground group-data-[orientation=horizontal]/tabs:h-10 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none data-[variant=line]:p-0',
        TABS_LIST_VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  value,
  disabled,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick' | 'value'> & { value: string }) {
  const context = useTabsContext();
  const active = context.value === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${context.baseId}-trigger-${value}`}
      aria-selected={active}
      aria-controls={`${context.baseId}-content-${value}`}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      data-slot="tabs-trigger"
      data-state={active ? 'active' : 'inactive'}
      data-value={value}
      onClick={() => context.setValue(value)}
      className={cn(
        "relative inline-flex h-[calc(100%-2px)] flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all duration-200 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-md group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent',
        'group-data-[variant=default]/tabs-list:data-[state=active]:bg-primary group-data-[variant=default]/tabs-list:data-[state=active]:text-primary-foreground group-data-[variant=default]/tabs-list:hover:data-[state=inactive]:bg-primary/10',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, value, ...props }: React.ComponentProps<'div'> & { value: string }) {
  const context = useTabsContext();
  if (context.value !== value) return null;

  return (
    <div
      data-slot="tabs-content"
      role="tabpanel"
      id={`${context.baseId}-content-${value}`}
      aria-labelledby={`${context.baseId}-trigger-${value}`}
      tabIndex={0}
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };

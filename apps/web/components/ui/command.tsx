'use client';

import * as React from 'react';
import { SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Replaces `cmdk`. Only `Command`/`CommandInput`/`CommandList`/`CommandEmpty`/
 *  `CommandGroup`/`CommandItem` are implemented — no consumer uses
 *  `CommandDialog`, `CommandSeparator`, or `CommandShortcut`.
 *
 *  Filtering is token-substring, not cmdk's fuzzy/subsequence scorer: the
 *  query is split on whitespace and every token must be a case-insensitive
 *  substring of the item's match text (its `value` prop, or its plain-string
 *  `children` if `value` isn't given). This is a real, deliberate behavior
 *  change from cmdk — e.g. "kpname" fuzzy-matching "kpi name" no longer
 *  works — accepted as more predictable for these name searches. */

function matchesQuery(text: string, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = text.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

const COMMAND_ITEM_SELECTOR = '[data-slot="command-item"]:not([hidden])';

const CommandContext = React.createContext<{
  query: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  registerItem: (id: string, onSelect: () => void) => () => void;
  itemsRef: React.RefObject<Map<string, () => void>>;
  /** Bumped whenever an item mounts/unmounts — the signal Command/CommandGroup
   *  re-derive isEmpty/activeId from, since items can appear asynchronously
   *  (a combobox's options fetched lazily on first open) without `query`
   *  itself changing. */
  itemsVersion: number;
  isEmpty: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
} | null>(null);

function useCommandContext() {
  const context = React.useContext(CommandContext);
  if (!context) throw new Error('Command.* must be rendered inside <Command>');
  return context;
}

function Command({ className, ...props }: React.ComponentProps<'div'>) {
  const [query, setQuery] = React.useState('');
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [isEmpty, setIsEmpty] = React.useState(false);
  const [itemsVersion, setItemsVersion] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const itemsRef = React.useRef(new Map<string, () => void>());

  const registerItem = React.useCallback((id: string, onSelect: () => void) => {
    itemsRef.current.set(id, onSelect);
    setItemsVersion((v) => v + 1);
    return () => {
      itemsRef.current.delete(id);
      setItemsVersion((v) => v + 1);
    };
  }, []);

  React.useLayoutEffect(() => {
    const visible = rootRef.current?.querySelectorAll(COMMAND_ITEM_SELECTOR).length ?? 0;
    setIsEmpty(visible === 0);
    const firstVisible = rootRef.current?.querySelector<HTMLElement>(COMMAND_ITEM_SELECTOR);
    setActiveId(firstVisible?.getAttribute('data-command-id') ?? null);
  }, [query, itemsVersion]);

  const context = React.useMemo(
    () => ({ query, activeId, setActiveId, registerItem, itemsRef, itemsVersion, isEmpty, rootRef }),
    [query, activeId, registerItem, itemsVersion, isEmpty],
  );

  return (
    <CommandContext.Provider value={context}>
      <CommandQueryContext.Provider value={setQuery}>
        <div
          ref={rootRef}
          data-slot="command"
          className={cn(
            'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
            className,
          )}
          {...props}
        />
      </CommandQueryContext.Provider>
    </CommandContext.Provider>
  );
}

const CommandQueryContext = React.createContext<React.Dispatch<React.SetStateAction<string>> | null>(null);

function CommandInput({ className, onKeyDown, ...props }: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>) {
  const { query, activeId, setActiveId, rootRef, itemsRef } = useCommandContext();
  const setQuery = React.useContext(CommandQueryContext);
  if (!setQuery) throw new Error('CommandInput must be rendered inside <Command>');

  function moveActive(direction: 1 | -1) {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(COMMAND_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el.getAttribute('data-command-id') === activeId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + items.length) % items.length;
    setActiveId(items[nextIndex]?.getAttribute('data-command-id') ?? null);
  }

  return (
    <div data-slot="command-input-wrapper" className="flex h-9 items-center gap-2 border-b px-3">
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <input
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="command-list"
        aria-activedescendant={activeId ?? undefined}
        data-slot="command-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveActive(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(-1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeId) itemsRef.current.get(activeId)?.();
          }
        }}
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      id="command-list"
      data-slot="command-list"
      role="listbox"
      className={cn('max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto p-1', className)}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<'div'>) {
  const { isEmpty } = useCommandContext();
  if (!isEmpty) return null;
  return <div data-slot="command-empty" className={cn('py-6 text-center text-sm', className)} {...props} />;
}

function CommandGroup({
  className,
  heading,
  children,
  ...props
}: React.ComponentProps<'div'> & { heading?: React.ReactNode }) {
  const { query, itemsVersion } = useCommandContext();
  const [empty, setEmpty] = React.useState(false);
  const groupRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const visible = groupRef.current?.querySelectorAll(COMMAND_ITEM_SELECTOR).length ?? 0;
    setEmpty(visible === 0);
  }, [query, itemsVersion]);

  return (
    <div
      ref={groupRef}
      data-slot="command-group"
      role="group"
      hidden={empty}
      className={cn('overflow-hidden p-1 text-foreground', className)}
      {...props}
    >
      {heading && !empty && <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{heading}</div>}
      {children}
    </div>
  );
}

function CommandItem({
  className,
  children,
  value,
  onSelect,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value' | 'onSelect'> & { value?: string; onSelect?: () => void }) {
  const { query, activeId, registerItem } = useCommandContext();
  const id = React.useId();
  const matchText = value ?? (typeof children === 'string' ? children : '');
  const visible = matchesQuery(matchText, query);
  const selected = activeId === id;

  React.useEffect(() => {
    if (!onSelect) return;
    return registerItem(id, onSelect);
  }, [id, onSelect, registerItem]);

  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      hidden={!visible}
      aria-selected={selected}
      id={id}
      data-slot="command-item"
      data-command-id={id}
      data-selected={selected}
      onClick={onSelect}
      className={cn(
        // --color-accent is the bright coral brand color — right for a CTA,
        // too jarring as a list-highlight. A light purple tint + purple text
        // matches this app's other selected-state treatments instead (see
        // e.g. .perm-resource .check-item:has(input:checked) in globals.css).
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none data-[selected=true]:[background-color:color-mix(in_srgb,var(--pulse-purple)_10%,var(--color-bg))] data-[selected=true]:[color:var(--pulse-purple)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };

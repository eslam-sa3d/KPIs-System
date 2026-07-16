'use client';

import * as React from 'react';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/primitives/portal';
import { useAnchoredPosition } from '@/components/ui/primitives/use-anchored-position';
import { useDismissableLayer } from '@/components/ui/primitives/use-dismissable-layer';
import { renderAsChild } from '@/components/ui/primitives/use-as-child';

/** Only `DropdownMenu`/`Trigger`/`Content`/`Item`/`CheckboxItem` are
 *  implemented — this app's only consumer (`forms/new/page.tsx`) never uses
 *  submenus or radio items, so those aren't built. */

type SelectEvent = { defaultPrevented: boolean; preventDefault: () => void };

function createSelectEvent(): SelectEvent {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([data-disabled]), [role="menuitemcheckbox"]:not([data-disabled])';

const DropdownMenuContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
} | null>(null);

function useDropdownMenuContext() {
  const context = React.useContext(DropdownMenuContext);
  if (!context) throw new Error('DropdownMenu.* must be rendered inside <DropdownMenu>');
  return context;
}

function DropdownMenu({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const context = React.useMemo(() => ({ open, setOpen, triggerRef, contentRef }), [open]);

  return <DropdownMenuContext.Provider value={context}>{children}</DropdownMenuContext.Provider>;
}

function DropdownMenuTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext();

  const triggerProps = {
    ...props,
    ref: triggerRef,
    'data-slot': 'dropdown-menu-trigger',
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    onClick: () => setOpen(!open),
  };

  if (asChild) {
    return renderAsChild(children as React.ReactElement, triggerProps);
  }

  return (
    <button type="button" {...triggerProps} ref={triggerRef as React.Ref<HTMLButtonElement>}>
      {children}
    </button>
  );
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: React.ComponentProps<'div'> & { sideOffset?: number; align?: 'start' | 'center' | 'end' }) {
  const { open, setOpen, triggerRef, contentRef } = useDropdownMenuContext();
  const { style, side } = useAnchoredPosition({ open, triggerRef, contentRef, side: 'bottom', align, sideOffset });

  useDismissableLayer({ open, onDismiss: () => setOpen(false), contentRef, excludeRefs: [triggerRef] });

  React.useEffect(() => {
    if (!open) return;
    const first = contentRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR);
    first?.focus();
  }, [open, contentRef]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    else nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;

    items[nextIndex]?.focus();
  }

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={contentRef}
        data-slot="dropdown-menu-content"
        data-side={side}
        role="menu"
        style={style}
        onKeyDown={handleKeyDown}
        className={cn(
          'z-50 max-h-[70vh] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </Portal>
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  disabled,
  onSelect,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onSelect'> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
  onSelect?: (event: SelectEvent) => void;
}) {
  const { setOpen } = useDropdownMenuContext();

  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      data-disabled={disabled ? '' : undefined}
      onClick={() => {
        const event = createSelectEvent();
        onSelect?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:bg-destructive/10 dark:data-[variant=destructive]:hover:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-destructive!",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked = false,
  onCheckedChange,
  onSelect,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onSelect'> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onSelect?: (event: SelectEvent) => void;
}) {
  const { setOpen } = useDropdownMenuContext();

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      tabIndex={-1}
      aria-checked={checked}
      data-slot="dropdown-menu-checkbox-item"
      onClick={() => {
        onCheckedChange?.(!checked);
        const event = createSelectEvent();
        onSelect?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        {checked && <CheckIcon className="size-4" />}
      </span>
      {children}
    </button>
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem };

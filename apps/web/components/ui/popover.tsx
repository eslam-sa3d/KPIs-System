'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/primitives/portal';
import { useAnchoredPosition } from '@/components/ui/primitives/use-anchored-position';
import { useControllableState } from '@/components/ui/primitives/use-controllable-state';
import { useDismissableLayer } from '@/components/ui/primitives/use-dismissable-layer';
import { renderAsChild } from '@/components/ui/primitives/use-as-child';

/** `PopoverAnchor`/`PopoverHeader`/`PopoverTitle`/`PopoverDescription` aren't
 *  implemented — every real usage in this app is a `Popover` wrapping a
 *  `Command` combobox, never plain text/form content. Non-modal: no focus
 *  trap or scroll lock, matching Radix's own `Popover.Content`. */

const PopoverContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
} | null>(null);

function usePopoverContext() {
  const context = React.useContext(PopoverContext);
  if (!context) throw new Error('Popover.* must be rendered inside <Popover>');
  return context;
}

function Popover({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const [current, setCurrent] = useControllableState({ value: open, defaultValue: false, onChange: onOpenChange });
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const context = React.useMemo(
    () => ({ open: current, setOpen: setCurrent, triggerRef, contentRef }),
    [current, setCurrent],
  );

  return <PopoverContext.Provider value={context}>{children}</PopoverContext.Provider>;
}

function PopoverTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { open, setOpen, triggerRef } = usePopoverContext();

  const triggerProps = {
    ...props,
    ref: triggerRef,
    'data-slot': 'popover-trigger',
    'aria-haspopup': 'dialog' as const,
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

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'center' | 'end'; sideOffset?: number }) {
  const { open, setOpen, triggerRef, contentRef } = usePopoverContext();
  const { style, side } = useAnchoredPosition({ open, triggerRef, contentRef, side: 'bottom', align, sideOffset });

  useDismissableLayer({ open, onDismiss: () => setOpen(false), contentRef, excludeRefs: [triggerRef] });

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={contentRef}
        data-slot="popover-content"
        data-side={side}
        role="dialog"
        style={style}
        className={cn(
          'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden',
          className,
        )}
        {...props}
      />
    </Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };

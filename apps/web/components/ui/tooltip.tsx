'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/primitives/portal';
import { useAnchoredPosition } from '@/components/ui/primitives/use-anchored-position';
import { renderAsChild } from '@/components/ui/primitives/use-as-child';

/** No-op passthrough kept for API parity with the previous Radix-based
 *  Tooltip, so `apps/web/app/layout.tsx`'s global `<TooltipProvider>` wrapper
 *  needs no edit beyond the import path — there's only ever one real
 *  `<Tooltip>` instance in this app, so a shared delay-timer context buys
 *  nothing over each Tooltip owning its own state. */
function TooltipProvider({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

const TooltipContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  contentId: string;
} | null>(null);

function useTooltipContext() {
  const context = React.useContext(TooltipContext);
  if (!context) throw new Error('Tooltip.* must be rendered inside <Tooltip>');
  return context;
}

function Tooltip({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const contentId = React.useId();
  const context = React.useMemo(() => ({ open, setOpen, triggerRef, contentId }), [open, contentId]);

  return <TooltipContext.Provider value={context}>{children}</TooltipContext.Provider>;
}

function TooltipTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { open, setOpen, triggerRef, contentId } = useTooltipContext();

  const handlers = {
    ...props,
    ref: triggerRef,
    'data-slot': 'tooltip-trigger',
    'aria-describedby': open ? contentId : undefined,
    onMouseEnter: () => {
      if (window.matchMedia?.('(pointer: coarse)').matches) return;
      setOpen(true);
    },
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  };

  if (asChild) {
    return renderAsChild(children as React.ReactElement, handlers);
  }

  return (
    <button type="button" {...handlers} ref={triggerRef as React.Ref<HTMLButtonElement>}>
      {children}
    </button>
  );
}

function TooltipContent({
  className,
  sideOffset = 8,
  side = 'top',
  align = 'center',
  children,
  ...props
}: React.ComponentProps<'div'> & {
  sideOffset?: number;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  const { open, triggerRef, contentId } = useTooltipContext();
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const { style, side: resolvedSide } = useAnchoredPosition({
    open,
    triggerRef,
    contentRef,
    side,
    align,
    sideOffset,
  });

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={contentRef}
        id={contentId}
        data-slot="tooltip-content"
        data-side={resolvedSide}
        role="tooltip"
        style={style}
        className={cn(
          'z-50 w-fit rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

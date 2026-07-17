'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/primitives/portal';
import { useControllableState } from '@/components/ui/primitives/use-controllable-state';
import { useDismissableLayer } from '@/components/ui/primitives/use-dismissable-layer';
import { useFocusTrap } from '@/components/ui/primitives/use-focus-trap';
import { useScrollLock } from '@/components/ui/primitives/use-scroll-lock';

/** `SheetTrigger`/`SheetClose`/`SheetDescription`/`SheetFooter` aren't
 *  implemented — the one real usage in this app mounts `<Sheet open>`
 *  externally-controlled with no trigger, footer, or description. */

const SheetContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
} | null>(null);

function useSheetContext() {
  const context = React.useContext(SheetContext);
  if (!context) throw new Error('Sheet.* must be rendered inside <Sheet>');
  return context;
}

function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const [current, setCurrent] = useControllableState({ value: open, defaultValue: false, onChange: onOpenChange });
  const titleId = React.useId();
  const context = React.useMemo(
    () => ({ open: current, setOpen: setCurrent, titleId }),
    [current, setCurrent, titleId],
  );

  return <SheetContext.Provider value={context}>{children}</SheetContext.Provider>;
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
}) {
  const { open, setOpen, titleId } = useSheetContext();
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  useFocusTrap({ open, contentRef });
  useScrollLock(open);
  useDismissableLayer({ open, onDismiss: () => setOpen(false), contentRef });

  if (!open) return null;

  return (
    <Portal>
      <div data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)} />
      <div
        ref={contentRef}
        data-slot="sheet-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-background shadow-lg',
          side === 'right' && 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
          side === 'left' && 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
          side === 'top' && 'inset-x-0 top-0 h-auto border-b',
          side === 'bottom' && 'inset-x-0 bottom-0 h-auto border-t',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <button
            type="button"
            data-slot="sheet-close"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 z-10 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    </Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const { titleId } = useSheetContext();
  return (
    <h2 id={titleId} data-slot="sheet-title" className={cn('font-semibold text-foreground', className)} {...props} />
  );
}

export { Sheet, SheetContent, SheetHeader, SheetTitle };

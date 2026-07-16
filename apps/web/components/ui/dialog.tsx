'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/primitives/portal';
import { useControllableState } from '@/components/ui/primitives/use-controllable-state';
import { useDismissableLayer } from '@/components/ui/primitives/use-dismissable-layer';
import { useFocusTrap } from '@/components/ui/primitives/use-focus-trap';
import { useScrollLock } from '@/components/ui/primitives/use-scroll-lock';

/** `DialogTrigger`/`DialogClose`/`DialogOverlay`/`DialogPortal`/`DialogDescription`
 *  aren't implemented — every real usage in this app always mounts `<Dialog
 *  open>` externally-controlled (no click-to-open trigger) and never renders
 *  a description. */

const DialogContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
} | null>(null);

function useDialogContext() {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error('Dialog.* must be rendered inside <Dialog>');
  return context;
}

function Dialog({
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

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  const { open, setOpen, titleId } = useDialogContext();
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  useFocusTrap({ open, contentRef });
  useScrollLock(open);
  useDismissableLayer({ open, onDismiss: () => setOpen(false), contentRef, onEscapeKeyDown });

  if (!open) return null;

  return (
    <Portal>
      <div data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)} />
      <div
        ref={contentRef}
        data-slot="dialog-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <button
            type="button"
            data-slot="dialog-close"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    </Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const { titleId } = useDialogContext();
  return (
    <h2
      id={titleId}
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle };

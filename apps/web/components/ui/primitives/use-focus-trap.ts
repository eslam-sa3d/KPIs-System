import * as React from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal focus trap for Dialog/Sheet: moves focus into the content on open,
 *  cycles Tab/Shift+Tab within it, and restores focus to whatever was
 *  focused before opening once it closes. Radix's `Dialog.Content` does this
 *  internally; Popover/DropdownMenu/Select don't need it (Radix doesn't trap
 *  focus for those either). */
export function useFocusTrap({ open, contentRef }: { open: boolean; contentRef: React.RefObject<HTMLElement | null> }) {
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const content = contentRef.current;
    const initial = content?.querySelector<HTMLElement>('[autofocus]') ?? content;
    initial?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !content) return;
      const focusable = Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!content.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.({ preventScroll: true });
    };
  }, [open, contentRef]);
}

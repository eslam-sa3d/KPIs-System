import * as React from 'react';

/** Escape-key + outside-pointerdown dismissal for one open overlay layer,
 *  replacing what Radix's `DismissableLayer` did internally.
 *
 *  `onEscapeKeyDown` mirrors Radix's own prop of the same name: it fires
 *  before the default dismiss, and calling `event.preventDefault()` inside
 *  it cancels the dismiss — this is what lets DialogContent forward the
 *  prop unchanged and keeps response-detail-modal.tsx's "swallow Escape
 *  while editing" behavior working without any call-site change. */
export function useDismissableLayer({
  open,
  onDismiss,
  contentRef,
  excludeRefs = [],
  onEscapeKeyDown,
}: {
  open: boolean;
  onDismiss: () => void;
  contentRef: React.RefObject<HTMLElement | null>;
  excludeRefs?: Array<React.RefObject<HTMLElement | null>>;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const onEscapeRef = React.useRef(onEscapeKeyDown);
  onEscapeRef.current = onEscapeKeyDown;

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      onEscapeRef.current?.(event);
      if (!event.defaultPrevented) onDismissRef.current();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (excludeRefs.some((ref) => ref.current?.contains(target))) return;
      onDismissRef.current();
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open, contentRef]);
}

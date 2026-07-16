import * as React from 'react';

/** Locks page scroll while `active`, restoring the previous inline style on
 *  cleanup. Used by Dialog/Sheet only — Radix doesn't scroll-lock for
 *  Popover/DropdownMenu/Select/Tooltip either. */
export function useScrollLock(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

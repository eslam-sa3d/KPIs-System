import * as React from 'react';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

const VIEWPORT_PADDING = 8;

/** Shared trigger-relative positioning for DropdownMenu/Select/Popover/Tooltip
 *  content, replacing Radix's Popper-based positioning. Computes a fixed
 *  `top`/`left` from the trigger's bounding rect, flips bottom<->top (or
 *  right<->left) on viewport collision, and recomputes on scroll/resize/content
 *  size change while open. Sets `data-side`/`data-align` to match this
 *  codebase's existing `data-[side=...]` selector conventions. */
export function useAnchoredPosition({
  open,
  triggerRef,
  contentRef,
  side = 'bottom',
  align = 'center',
  sideOffset = 4,
  matchTriggerWidth = false,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  matchTriggerWidth?: boolean;
}) {
  const [style, setStyle] = React.useState<React.CSSProperties>({});
  const [resolvedSide, setResolvedSide] = React.useState<Side>(side);
  const [resolvedAlign, setResolvedAlign] = React.useState<Align>(align);

  React.useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;

    function recompute() {
      const t = trigger!.getBoundingClientRect();
      const c = content!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let finalSide = side;
      const horizontal = side === 'left' || side === 'right';

      if (!horizontal) {
        const fitsBelow = t.bottom + sideOffset + c.height <= vh;
        const fitsAbove = t.top - sideOffset - c.height >= 0;
        if (side === 'bottom' && !fitsBelow && fitsAbove) finalSide = 'top';
        if (side === 'top' && !fitsAbove && fitsBelow) finalSide = 'bottom';
      } else {
        const fitsRight = t.right + sideOffset + c.width <= vw;
        const fitsLeft = t.left - sideOffset - c.width >= 0;
        if (side === 'right' && !fitsRight && fitsLeft) finalSide = 'left';
        if (side === 'left' && !fitsLeft && fitsRight) finalSide = 'right';
      }

      let top: number;
      let left: number;

      if (finalSide === 'bottom') top = t.bottom + sideOffset;
      else if (finalSide === 'top') top = t.top - sideOffset - c.height;
      else
        top = align === 'end' ? t.bottom - c.height : align === 'start' ? t.top : t.top + t.height / 2 - c.height / 2;

      if (finalSide === 'left') left = t.left - sideOffset - c.width;
      else if (finalSide === 'right') left = t.right + sideOffset;
      else left = align === 'end' ? t.right - c.width : align === 'start' ? t.left : t.left + t.width / 2 - c.width / 2;

      left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - c.width - VIEWPORT_PADDING));
      top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - c.height - VIEWPORT_PADDING));

      setResolvedSide(finalSide);
      setResolvedAlign(align);
      setStyle({
        position: 'fixed',
        top,
        left,
        ...(matchTriggerWidth ? { width: t.width } : { minWidth: t.width }),
      });
    }

    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(content);
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open, side, align, sideOffset, matchTriggerWidth, triggerRef, contentRef]);

  return { style, side: resolvedSide, align: resolvedAlign };
}

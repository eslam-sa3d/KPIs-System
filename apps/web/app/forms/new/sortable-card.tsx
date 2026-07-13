'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>;

/** A drag-sortable <fieldset> wrapper. Pulled out as its own component (not
 *  inlined in a .map()) because useSortable is a hook — it can only run once
 *  per rendered item, which means once per component instance. */
export function SortableCard({
  id,
  className,
  style,
  onFocus,
  onClick,
  setRef,
  children,
}: {
  id: string | number;
  className: string;
  style?: React.CSSProperties;
  onFocus?: () => void;
  onClick?: () => void;
  setRef?: (el: HTMLFieldSetElement | null) => void;
  children: (drag: DragHandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <fieldset
      ref={(el) => {
        setRef?.(el);
        setNodeRef(el);
      }}
      style={{ ...style, transform: CSS.Transform.toString(transform), transition }}
      className={`${className}${isDragging ? ' is-dragging' : ''}`}
      onFocus={onFocus}
      onClick={onClick}
    >
      {children({ attributes, listeners })}
    </fieldset>
  );
}

/** A drag-sortable <div> wrapper — same shape as SortableCard, for lighter-weight
 *  rows (e.g. option rows within a field) that shouldn't be a nested <fieldset>. */
export function SortableRow({
  id,
  className,
  children,
}: {
  id: string | number;
  className: string;
  children: (drag: DragHandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${className}${isDragging ? ' is-dragging' : ''}`}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

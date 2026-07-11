'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>;

/** A drag-sortable wrapper. Pulled out as its own component (not inlined in
 *  a .map()) because useSortable is a hook — it can only run once per
 *  rendered item, i.e. once per component instance. */
export function SortableItem({
  id,
  className,
  onClick,
  children,
}: {
  id: string;
  className?: string;
  onClick?: () => void;
  children: (drag: DragHandleProps, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={className}
      onClick={onClick}
    >
      {children({ attributes, listeners }, isDragging)}
    </div>
  );
}

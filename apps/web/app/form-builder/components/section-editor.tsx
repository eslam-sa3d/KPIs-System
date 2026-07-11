'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBuilderStore } from '../lib/store';
import type { FormSection } from '../lib/types';
import { QuestionCard } from './question-card';

interface DragHandleProps {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
}

/** Google Forms renders a section as its own tinted header card, followed by
 *  that section's question cards as independent siblings in the same
 *  vertical flow — not one shared bordered box enclosing everything. Section
 *  drag-and-drop still moves the header + its questions as one unit; that's
 *  just not expressed as a visual container here. */
export function SectionEditor({
  section,
  index,
  total,
  drag,
  isDragging,
  allSections,
}: {
  section: FormSection;
  index: number;
  total: number;
  drag: DragHandleProps;
  isDragging: boolean;
  allSections: FormSection[];
}) {
  const fields = useBuilderStore((s) => s.form.fields);
  const updateSection = useBuilderStore((s) => s.updateSection);
  const removeSection = useBuilderStore((s) => s.removeSection);
  const reorderFieldInSection = useBuilderStore((s) => s.reorderFieldInSection);
  const addField = useBuilderStore((s) => s.addField);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <div className={`group flex flex-col gap-4 ${isDragging ? 'opacity-40' : ''}`}>
      <div className="overflow-hidden rounded-lg border border-[#dadce0] border-t-8 border-t-[#673ab7] bg-white shadow-sm">
        <button
          type="button"
          className="flex h-4 w-full cursor-grab items-center justify-center text-[#dadce0] opacity-0 transition-opacity hover:text-[#5f6368] active:cursor-grabbing group-hover:opacity-100"
          aria-label={`Drag to reorder section ${index + 1}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <GripVertical className="size-4 rotate-90" />
        </button>
        <div className="flex flex-col gap-1 px-6 pb-4">
          <p className="text-xs font-medium text-[#673ab7]">
            Section {index + 1} of {total}
          </p>
          <Input
            value={section.title}
            onChange={(e) => updateSection(section.id, { title: e.target.value })}
            placeholder={`Section ${index + 1}`}
            className="h-auto border-0 border-b border-[#e0e0e0] px-0 text-xl font-normal text-[#202124] shadow-none focus-visible:border-[#673ab7] focus-visible:ring-0"
          />
          <Input
            value={section.description}
            onChange={(e) => updateSection(section.id, { description: e.target.value })}
            placeholder="Description (optional)"
            className="h-auto border-0 px-0 text-sm text-[#5f6368] shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center justify-end border-t border-[#e0e0e0] bg-[#faf9fb] px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete section"
            disabled={total <= 1}
            title={total <= 1 ? 'a form always keeps at least one section' : 'Delete section'}
            onClick={() => removeSection(section.id)}
          >
            <Trash2 className="size-4 text-[#5f6368]" />
          </Button>
        </div>
      </div>

      <DndContext
        id={`fields-dnd-${section.id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id) reorderFieldInSection(section.id, String(active.id), String(over.id));
        }}
      >
        <SortableContext items={section.fieldIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {section.fieldIds.map((fieldId) => {
              const field = fields[fieldId];
              return field ? (
                <QuestionCard key={fieldId} field={field} section={section} allSections={allSections} />
              ) : null;
            })}
          </div>
        </SortableContext>
      </DndContext>

      {section.fieldIds.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#dadce0] bg-white py-8 text-center text-sm text-[#5f6368]">
          <p>No questions in this section yet.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => addField(section.id, null, 'short_answer')}>
            <Plus className="size-4" /> Add question
          </Button>
        </div>
      )}
    </div>
  );
}

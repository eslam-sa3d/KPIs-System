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
    <div className={`rounded-xl border bg-card ${isDragging ? 'opacity-40' : 'border-border'}`}>
      <div className="flex items-center gap-2 rounded-t-xl border-b border-border bg-muted/40 px-4 py-2">
        <button
          type="button"
          className="cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
          aria-label={`Drag to reorder section ${index + 1}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Section {index + 1} of {total}
        </span>
        <div className="ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete section"
            disabled={total <= 1}
            title={total <= 1 ? 'a form always keeps at least one section' : 'Delete section'}
            onClick={() => removeSection(section.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-4">
        <Input
          value={section.title}
          onChange={(e) => updateSection(section.id, { title: e.target.value })}
          placeholder={`Section ${index + 1} title`}
          className="text-base font-medium"
        />
        <Input
          value={section.description}
          onChange={(e) => updateSection(section.id, { description: e.target.value })}
          placeholder="Description (optional)"
          className="text-sm text-muted-foreground"
        />

        <DndContext
          id={`fields-dnd-${section.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (over && active.id !== over.id) reorderFieldInSection(section.id, String(active.id), String(over.id));
          }}
        >
          <SortableContext items={section.fieldIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3 pt-2">
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
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <p>No questions in this section yet.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => addField(section.id, null, 'short_answer')}>
              <Plus className="size-4" /> Add question
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

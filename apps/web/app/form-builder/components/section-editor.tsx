'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
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
    <div className={`fb-section-group${isDragging ? ' is-dragging' : ''}`}>
      <div style={{ overflow: 'hidden', borderRadius: 'var(--radius-lg)', border: '1px solid #dadce0', borderTop: '8px solid #673ab7', background: 'white', boxShadow: 'var(--shadow-card)' }}>
        <button
          type="button"
          className="fb-section-drag-handle"
          aria-label={`Drag to reorder section ${index + 1}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <GripVertical size={16} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 24px 16px' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 500, color: '#673ab7' }}>
            Section {index + 1} of {total}
          </p>
          <Input
            value={section.title}
            onChange={(e) => updateSection(section.id, { title: e.target.value })}
            placeholder={`Section ${index + 1}`}
            className="fb-section-title-input"
          />
          <Input
            value={section.description}
            onChange={(e) => updateSection(section.id, { description: e.target.value })}
            placeholder="Description (optional)"
            className="fb-section-description-input"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderTop: '1px solid #e0e0e0', background: '#faf9fb', padding: '8px 12px' }}>
          <IconButton
            icon={Trash2}
            label={total <= 1 ? 'a form always keeps at least one section' : 'Delete section'}
            isDisabled={total <= 1}
            onClick={() => removeSection(section.id)}
          />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderRadius: 'var(--radius-lg)', border: '1px dashed #dadce0', background: 'white', padding: '32px 0', textAlign: 'center', fontSize: '0.875rem', color: '#5f6368' }}>
          <p>No questions in this section yet.</p>
          <Button type="button" variant="outline" size="sm" iconBefore={Plus} onClick={() => addField(section.id, null, 'short_answer')}>
            Add question
          </Button>
        </div>
      )}
    </div>
  );
}

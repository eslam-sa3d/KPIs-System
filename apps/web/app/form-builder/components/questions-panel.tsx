'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBuilderStore } from '../lib/store';
import { SortableItem } from './sortable-item';
import { SectionEditor } from './section-editor';

export function QuestionsPanel() {
  const title = useBuilderStore((s) => s.form.title);
  const description = useBuilderStore((s) => s.form.description);
  const theme = useBuilderStore((s) => s.form.theme);
  const sections = useBuilderStore((s) => s.form.sections);
  const setTitle = useBuilderStore((s) => s.setTitle);
  const setDescription = useBuilderStore((s) => s.setDescription);
  const reorderSections = useBuilderStore((s) => s.reorderSections);
  const addSection = useBuilderStore((s) => s.addSection);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          borderLeft: '1px solid var(--color-border)',
          borderRight: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          borderTop: `8px solid ${theme.primaryColor}`,
          background: 'white',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {theme.headerImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL preview
          <img src={theme.headerImageUrl} alt="" style={{ height: 160, width: '100%', objectFit: 'cover' }} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 24 }}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled form"
            className="fb-form-title-input"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Form description"
            className="fb-form-description-input"
          />
        </div>
        <div style={{ height: 1, background: 'var(--color-border)' }} />
        <p style={{ padding: '8px 24px', fontSize: '0.75rem', color: '#dc2626' }}>* Indicates required question</p>
      </div>

      <DndContext
        id="sections-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id) reorderSections(String(active.id), String(over.id));
        }}
      >
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sections.map((section, i) => (
              <SortableItem key={section.id} id={section.id}>
                {(drag, isDragging) => (
                  <SectionEditor
                    section={section}
                    index={i}
                    total={sections.length}
                    drag={drag}
                    isDragging={isDragging}
                    allSections={sections}
                  />
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <span style={{ alignSelf: 'flex-start' }}>
        <Button type="button" variant="outline" iconBefore={Plus} onClick={() => addSection(sections[sections.length - 1]?.id ?? null)}>
          Add section
        </Button>
      </span>
    </div>
  );
}

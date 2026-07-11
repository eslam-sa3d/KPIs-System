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
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border-t-8 border border-border bg-white shadow-sm" style={{ borderTopColor: theme.primaryColor }}>
        {theme.headerImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL preview
          <img src={theme.headerImageUrl} alt="" className="h-40 w-full object-cover" />
        )}
        <div className="flex flex-col gap-2 p-6">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled form"
            className="h-auto border-none px-0 text-[28px] font-normal text-[#202124] shadow-none focus-visible:ring-0"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Form description"
            className="h-auto border-none px-0 text-sm text-[#5f6368] shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="h-px bg-border" />
        <p className="px-6 py-2 text-xs text-red-600">* Indicates required question</p>
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
          <div className="flex flex-col gap-4">
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

      <Button type="button" variant="outline" className="self-start bg-white" onClick={() => addSection(sections[sections.length - 1]?.id ?? null)}>
        <Plus className="size-4" /> Add section
      </Button>
    </div>
  );
}

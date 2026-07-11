'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBuilderStore } from '../lib/store';
import { SortableItem } from './sortable-item';
import { SectionEditor } from './section-editor';
import { ThemePanel } from './theme-panel';

const FONT_STACKS: Record<string, string> = {
  default: 'inherit',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  monospace: 'ui-monospace, Menlo, Consolas, monospace',
};

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
    <div className="space-y-4">
      <ThemePanel />

      <div
        className="space-y-4 rounded-xl p-4"
        style={{ background: theme.backgroundColor, fontFamily: FONT_STACKS[theme.fontStyle] }}
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="h-2" style={{ background: theme.primaryColor }} aria-hidden />
          {theme.headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL preview
            <img src={theme.headerImageUrl} alt="" className="h-40 w-full object-cover" />
          )}
          <div className="space-y-2 p-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled form"
              className="border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Form description"
              className="border-none px-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
            />
          </div>
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
            <div className="space-y-4">
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

        <Button type="button" variant="outline" onClick={() => addSection(sections[sections.length - 1]?.id ?? null)}>
          <Plus className="size-4" /> Add section
        </Button>
      </div>
    </div>
  );
}

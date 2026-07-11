'use client';

import { Copy, GripVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useBuilderStore } from '../lib/store';
import { createField, FIELD_TYPE_LABELS } from '../lib/field-defaults';
import { FIELD_TYPES, type FieldType, type FormField, type FormSection } from '../lib/types';
import { SortableItem } from './sortable-item';
import { QuestionBody } from './question-body';
import { FloatingToolbar } from './floating-toolbar';

export function QuestionCard({
  field,
  section,
  allSections,
}: {
  field: FormField;
  section: FormSection;
  allSections: FormSection[];
}) {
  const isActive = useBuilderStore((s) => s.activeFieldId === field.id);
  const setActiveField = useBuilderStore((s) => s.setActiveField);
  const updateField = useBuilderStore((s) => s.updateField);
  const duplicateField = useBuilderStore((s) => s.duplicateField);
  const removeField = useBuilderStore((s) => s.removeField);
  const isTitleBlock = field.type === 'title_block';

  // Switching type re-derives type-specific defaults (a fresh option list,
  // scale, etc.) while keeping the universal props — Google Forms only
  // preserves data automatically between closely-related choice types,
  // which this prototype simplifies to "always start fresh."
  function onTypeChange(nextType: FieldType) {
    const fresh = createField(nextType);
    updateField(field.id, { ...fresh, id: field.id, title: field.title, description: field.description, required: field.required });
  }

  return (
    <SortableItem id={field.id}>
      {(drag, isDragging) => (
        <div
          className={`relative rounded-xl border bg-card p-4 shadow-sm transition-colors ${
            isActive ? 'border-primary shadow-md' : 'border-border'
          } ${isDragging ? 'opacity-40' : ''}`}
          onFocus={() => setActiveField(field.id)}
          onClick={() => setActiveField(field.id)}
        >
          <button
            type="button"
            className="mb-2 flex h-4 w-full cursor-grab items-center justify-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
            aria-label="Drag to reorder"
            {...drag.attributes}
            {...drag.listeners}
          >
            <GripVertical className="size-4" />
          </button>

          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[200px] flex-1 space-y-2">
              <Input
                value={field.title}
                onChange={(e) => updateField(field.id, { title: e.target.value })}
                placeholder={isTitleBlock ? 'Section title' : 'Question'}
                className={isTitleBlock ? 'text-lg font-medium' : undefined}
              />
              {(isActive || field.description) && (
                <Input
                  value={field.description}
                  onChange={(e) => updateField(field.id, { description: e.target.value })}
                  placeholder={isTitleBlock ? 'Description (optional)' : 'Help text (optional)'}
                  className="text-sm text-muted-foreground"
                />
              )}
            </div>

            {!isTitleBlock && (
              <Select value={field.type} onValueChange={(v) => onTypeChange(v as FieldType)}>
                <SelectTrigger className="h-9 w-52 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {FIELD_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {field.media && (
            <div className="mt-3 space-y-1">
              {field.media.type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL, not an optimizable remote asset
                <img src={field.media.url} alt="" className="max-h-52 rounded-lg border border-border object-cover" />
              ) : (
                <div className="break-all rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
                  video: {field.media.url}
                </div>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => updateField(field.id, { media: undefined })}>
                Remove media
              </Button>
            </div>
          )}

          {isActive && !isTitleBlock && <QuestionBody field={field} section={section} allSections={allSections} />}

          <div className="mt-4 flex items-center justify-end gap-3 border-t border-border pt-3">
            <Button type="button" variant="ghost" size="icon" aria-label="Duplicate" onClick={() => duplicateField(field.id)}>
              <Copy className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Delete" onClick={() => removeField(field.id)}>
              <Trash2 className="size-4" />
            </Button>
            {!isTitleBlock && (
              <>
                <div className="h-5 w-px bg-border" />
                <label className="flex items-center gap-2 text-sm">
                  Required
                  <Switch checked={field.required} onCheckedChange={(v) => updateField(field.id, { required: v })} />
                </label>
              </>
            )}
          </div>

          {isActive && <FloatingToolbar sectionId={section.id} fieldId={field.id} />}
        </div>
      )}
    </SortableItem>
  );
}

'use client';

import { useState } from 'react';
import { Copy, GripVertical, MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBuilderStore } from '../lib/store';
import { createField, FIELD_TYPE_LABELS } from '../lib/field-defaults';
import { FIELD_TYPE_ICONS } from '../lib/constants';
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

  const [showValidation, setShowValidation] = useState(
    (field.type === 'short_answer' || field.type === 'paragraph') && field.validation.kind !== 'none',
  );
  const [branchingOpen, setBranchingOpen] = useState(
    (field.type === 'multiple_choice' || field.type === 'dropdown') && Object.keys(field.branching).length > 0,
  );

  // Switching type re-derives type-specific defaults (a fresh option list,
  // scale, etc.) while keeping the universal props — Google Forms only
  // preserves data automatically between closely-related choice types,
  // which this prototype simplifies to "always start fresh."
  function onTypeChange(nextType: FieldType) {
    const fresh = createField(nextType);
    updateField(field.id, { ...fresh, id: field.id, title: field.title, description: field.description, required: field.required });
    setShowValidation(false);
    setBranchingOpen(false);
  }

  const hasOverflowMenu =
    field.type === 'short_answer' ||
    field.type === 'paragraph' ||
    field.type === 'multiple_choice' ||
    field.type === 'checkboxes' ||
    field.type === 'dropdown';

  return (
    <SortableItem id={field.id}>
      {(drag, isDragging) => (
        <div
          className={`group relative rounded-lg border bg-white p-6 shadow-sm transition-shadow ${
            isActive ? 'border-[#dadce0] border-l-4 border-l-[#673ab7] shadow-md' : 'border-[#dadce0]'
          } ${isDragging ? 'opacity-40' : ''}`}
          onFocus={() => setActiveField(field.id)}
          onClick={() => setActiveField(field.id)}
        >
          <button
            type="button"
            className={`absolute inset-x-0 -top-1 flex h-4 w-full cursor-grab items-center justify-center text-[#dadce0] opacity-0 transition-opacity hover:text-[#5f6368] active:cursor-grabbing group-hover:opacity-100 ${
              isActive ? 'opacity-100' : ''
            }`}
            aria-label="Drag to reorder"
            {...drag.attributes}
            {...drag.listeners}
          >
            <GripVertical className="size-4 rotate-90" />
          </button>

          <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-[200px] flex-1 flex-col gap-1">
              <Input
                value={field.title}
                onChange={(e) => updateField(field.id, { title: e.target.value })}
                placeholder={isTitleBlock ? 'Section title' : 'Question'}
                className={`h-auto border-0 border-b px-0 shadow-none focus-visible:border-[#673ab7] focus-visible:ring-0 ${
                  isTitleBlock ? 'text-xl font-medium border-transparent' : 'border-[#e0e0e0]'
                }`}
              />
              {(isActive || field.description) && (
                <Input
                  value={field.description}
                  onChange={(e) => updateField(field.id, { description: e.target.value })}
                  placeholder={isTitleBlock ? 'Description (optional)' : 'Help text (optional)'}
                  className="h-auto border-0 px-0 text-sm text-[#5f6368] shadow-none focus-visible:ring-0"
                />
              )}
            </div>

            {!isTitleBlock && (
              <div className="flex shrink-0 items-center gap-1">
                <Select value={field.type} onValueChange={(v) => onTypeChange(v as FieldType)}>
                  <SelectTrigger className="h-9 w-60 border-[#dadce0]">
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        {(() => {
                          const Icon = FIELD_TYPE_ICONS[field.type];
                          return <Icon className="size-4 text-[#5f6368]" />;
                        })()}
                        {FIELD_TYPE_LABELS[field.type]}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((type) => {
                      const Icon = FIELD_TYPE_ICONS[type];
                      return (
                        <SelectItem key={type} value={type}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-4 text-[#5f6368]" />
                            {FIELD_TYPE_LABELS[type]}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {hasOverflowMenu && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label="More question options">
                        <MoreVertical className="size-4 text-[#5f6368]" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(field.type === 'short_answer' || field.type === 'paragraph') && (
                        <DropdownMenuCheckboxItem checked={showValidation} onCheckedChange={setShowValidation}>
                          Response validation
                        </DropdownMenuCheckboxItem>
                      )}
                      {(field.type === 'multiple_choice' || field.type === 'checkboxes' || field.type === 'dropdown') && (
                        <DropdownMenuCheckboxItem
                          checked={field.shuffleOptions}
                          onCheckedChange={(v) => updateField(field.id, { shuffleOptions: v })}
                        >
                          Shuffle option order
                        </DropdownMenuCheckboxItem>
                      )}
                      {(field.type === 'multiple_choice' || field.type === 'dropdown') && (
                        <DropdownMenuCheckboxItem checked={branchingOpen} onCheckedChange={setBranchingOpen}>
                          Go to section based on answer
                        </DropdownMenuCheckboxItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>

          {field.media && (
            <div className="flex flex-col gap-1">
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

          {isActive && !isTitleBlock && (
            <QuestionBody
              field={field}
              section={section}
              allSections={allSections}
              showValidation={showValidation}
              branchingOpen={branchingOpen}
            />
          )}

          {!isTitleBlock && (
            <div className="flex items-center justify-end gap-3 border-t border-[#e0e0e0] pt-3">
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label="Duplicate" onClick={() => duplicateField(field.id)}>
                  <Copy className="size-4 text-[#5f6368]" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Delete" onClick={() => removeField(field.id)}>
                  <Trash2 className="size-4 text-[#5f6368]" />
                </Button>
              </div>
              <div className="h-6 w-px bg-[#e0e0e0]" />
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#5f6368]">Required</span>
                <Switch checked={field.required} onCheckedChange={(v) => updateField(field.id, { required: v })} />
              </div>
            </div>
          )}
          {isTitleBlock && (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="icon" aria-label="Delete block" onClick={() => removeField(field.id)}>
                <Trash2 className="size-4 text-[#5f6368]" />
              </Button>
            </div>
          )}

          {isActive && <FloatingToolbar sectionId={section.id} fieldId={field.id} />}
          </div>
        </div>
      )}
    </SortableItem>
  );
}

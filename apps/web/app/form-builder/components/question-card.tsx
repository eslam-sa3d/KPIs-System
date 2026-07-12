'use client';

import { useRef, useState } from 'react';
import { Copy, GripHorizontal, Image as ImageIcon, MoreVertical, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
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
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    updateField(field.id, { media: { type: 'image', url: URL.createObjectURL(file) } });
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
          className={`fb-question-card${isActive ? ' is-active' : ''}${isDragging ? ' is-dragging' : ''}`}
          onFocus={() => setActiveField(field.id)}
          onClick={() => setActiveField(field.id)}
        >
          <button
            type="button"
            className={`fb-drag-handle${isActive ? ' is-active' : ''}`}
            aria-label="Drag to reorder"
            {...drag.attributes}
            {...drag.listeners}
          >
            <GripHorizontal size={16} />
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', minWidth: 200, flex: 1, flexDirection: 'column', gap: 8 }}>
              <Input
                value={field.title}
                onChange={(e) => updateField(field.id, { title: e.target.value })}
                placeholder={isTitleBlock ? 'Section title' : 'Untitled Question'}
                className={isTitleBlock ? 'fb-title-input' : 'fb-question-title-input'}
              />
              {(isActive || field.description) && (
                <Input
                  value={field.description}
                  onChange={(e) => updateField(field.id, { description: e.target.value })}
                  placeholder={isTitleBlock ? 'Description (optional)' : 'Help text (optional)'}
                  className="fb-description-input"
                />
              )}
            </div>

            {!isTitleBlock && (
              <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 }}>
                <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
                <IconButton
                  icon={ImageIcon}
                  label="Add image"
                  onClick={() => imageInputRef.current?.click()}
                />

                <div style={{ width: 240 }}>
                  <Select value={field.type} onValueChange={(v) => onTypeChange(v as FieldType)}>
                    <SelectTrigger>
                      <SelectValue>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {(() => {
                            const Icon = FIELD_TYPE_ICONS[field.type];
                            return <Icon size={16} color="#5f6368" />;
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
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Icon size={16} color="#5f6368" />
                              {FIELD_TYPE_LABELS[type]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {field.media && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {field.media.type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL, not an optimizable remote asset
                <img
                  src={field.media.url}
                  alt=""
                  style={{ maxHeight: 208, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    wordBreak: 'break-all',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    padding: 12,
                    fontSize: '0.75rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <IconButton icon={Copy} label="Duplicate" onClick={() => duplicateField(field.id)} />
                <IconButton icon={Trash2} label="Delete" onClick={() => removeField(field.id)} />
              </div>
              <div style={{ height: 24, width: 1, background: '#e0e0e0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.875rem', color: '#5f6368' }}>Required</span>
                <Switch checked={field.required} onCheckedChange={(v) => updateField(field.id, { required: v })} />
              </div>
              {hasOverflowMenu && (
                <>
                  <div style={{ height: 24, width: 1, background: '#e0e0e0' }} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton icon={MoreVertical} label="More question options" />
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
                </>
              )}
            </div>
          )}
          {isTitleBlock && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <IconButton icon={Trash2} label="Delete block" onClick={() => removeField(field.id)} />
            </div>
          )}

          {isActive && <FloatingToolbar sectionId={section.id} fieldId={field.id} />}
          </div>
        </div>
      )}
    </SortableItem>
  );
}

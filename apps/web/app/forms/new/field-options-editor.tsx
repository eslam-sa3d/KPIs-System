import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical, User as UserIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { END_OF_FORM } from '@pulse/contracts';
import { UserPickerCombobox } from '../../../components/user-picker-combobox';
import { parseList } from './field-transforms';
import { SortableRow } from './sortable-card';
import type { DraftField } from './types';

/**
 * The options list editor for select/multi_select/ranking fields: drag-to-
 * reorder rows, per-option "go to section" branching, "Other" toggle, and
 * the add-option/add-a-user/add-all-users row underneath.
 */
export function FieldOptionsEditor({
  field,
  fieldIndex,
  dragSensors,
  laterSectionsForField,
  branchingOpen,
  updateField,
  onOptionDragEnd,
  addAllUsersAsOptions,
}: {
  field: DraftField;
  fieldIndex: number;
  dragSensors: SensorDescriptor<SensorOptions>[];
  laterSectionsForField: Array<{ id: string; title: string }>;
  branchingOpen: boolean;
  updateField: (index: number, patch: Partial<DraftField>) => void;
  onOptionDragEnd: (fieldIndex: number, event: DragEndEvent) => void;
  addAllUsersAsOptions: (index: number) => void;
}) {
  const index = fieldIndex;
  return (
    <>
      <span className="field-label">Options</span>
      <div className="option-rows">
        <DndContext
          sensors={dragSensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => onOptionDragEnd(index, event)}
        >
          <SortableContext items={parseList(field.options).map((_, i) => i)} strategy={verticalListSortingStrategy}>
            {parseList(field.options).map((optionValue, optionIndex) => (
              <SortableRow key={optionIndex} id={optionIndex} className="option-row">
                {(optionDrag) => (
                  <>
                    <button
                      type="button"
                      className="option-row-drag-handle"
                      title="Drag to reorder"
                      aria-label={`Drag to reorder option ${optionIndex + 1}`}
                      {...optionDrag.attributes}
                      {...optionDrag.listeners}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </button>
                    <span
                      className={`option-row-mark${
                        field.type === 'multi_select' ? ' is-checkbox' : field.type === 'ranking' ? ' is-rank' : ''
                      }`}
                    >
                      {field.type === 'ranking' ? optionIndex + 1 : ''}
                    </span>
                    <Input
                      value={optionValue}
                      onChange={(e) => {
                        const list = parseList(field.options);
                        const previous = list[optionIndex]!;
                        list[optionIndex] = e.target.value;
                        const renamed = previous !== e.target.value;
                        updateField(index, {
                          options: list.join(', '),
                          // keep this option's "go to" mapping and user link keyed to its (possibly renamed) text
                          ...(renamed && previous in field.optionGoTo
                            ? {
                                optionGoTo: Object.fromEntries(
                                  Object.entries(field.optionGoTo).map(([k, v]) =>
                                    k === previous ? [e.target.value, v] : [k, v],
                                  ),
                                ),
                              }
                            : {}),
                          ...(renamed && previous in field.optionUserIds
                            ? {
                                optionUserIds: Object.fromEntries(
                                  Object.entries(field.optionUserIds).map(([k, v]) =>
                                    k === previous ? [e.target.value, v] : [k, v],
                                  ),
                                ),
                              }
                            : {}),
                        });
                      }}
                      placeholder={`Option ${optionIndex + 1}`}
                    />
                    {field.optionUserIds[optionValue] && (
                      <span
                        className="option-row-user-mark"
                        title="Linked to a user — the answer will be that person's id"
                      >
                        <UserIcon size={14} aria-hidden="true" />
                      </span>
                    )}
                    {field.type === 'select' && laterSectionsForField.length > 0 && branchingOpen && (
                      <Select
                        value={field.optionGoTo[optionValue] || '__none__'}
                        onValueChange={(v) =>
                          updateField(index, {
                            optionGoTo: { ...field.optionGoTo, [optionValue]: v === '__none__' ? '' : v },
                          })
                        }
                      >
                        <SelectTrigger className="option-row-goto" aria-label={`Go to section after "${optionValue}"`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Continue to next section</SelectItem>
                          {laterSectionsForField.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              Go to {t.title.trim() || t.id}
                            </SelectItem>
                          ))}
                          <SelectItem value={END_OF_FORM}>Submit form</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="option-row-remove"
                      title="Remove option"
                      aria-label={`Remove option ${optionIndex + 1}`}
                      onClick={() => {
                        const list = parseList(field.options).filter((_, i) => i !== optionIndex);
                        const { [optionValue]: _removed, ...optionGoTo } = field.optionGoTo;
                        const { [optionValue]: _removedUser, ...optionUserIds } = field.optionUserIds;
                        updateField(index, { options: list.join(', '), optionGoTo, optionUserIds });
                      }}
                    >
                      <X size={12} aria-hidden="true" />
                    </Button>
                  </>
                )}
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
        {(field.type === 'select' || field.type === 'multi_select') && field.allowOther && (
          <div className="option-row option-row-other">
            <span className={`option-row-mark${field.type === 'multi_select' ? ' is-checkbox' : ''}`} />
            <span className="option-row-other-label">Other…</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="option-row-remove"
              title='Remove "other"'
              aria-label="Remove other"
              onClick={() => updateField(index, { allowOther: false })}
            >
              <X size={12} aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="option-row-add-line">
          <Button
            type="button"
            variant="ghost"
            className="option-row-add"
            onClick={() => {
              const list = parseList(field.options);
              list.push(`Option ${list.length + 1}`);
              updateField(index, { options: list.join(', ') });
            }}
          >
            <span className={`option-row-mark${field.type === 'multi_select' ? ' is-checkbox' : ''}`} />
            Add option
          </Button>
          {(field.type === 'select' || field.type === 'multi_select') && !field.allowOther && (
            <>
              {' '}
              or{' '}
              <Button
                type="button"
                variant="ghost"
                className="option-row-other-link"
                onClick={() => updateField(index, { allowOther: true })}
              >
                Add &quot;Other&quot;
              </Button>
            </>
          )}
          {(field.type === 'select' || field.type === 'multi_select') && (
            <>
              {' '}
              or{' '}
              <UserPickerCombobox
                triggerLabel="Select a user"
                onSelect={(u) => {
                  const list = parseList(field.options);
                  list.push(u.displayName);
                  updateField(index, {
                    options: list.join(', '),
                    optionUserIds: { ...field.optionUserIds, [u.displayName]: u.id },
                  });
                }}
              />
            </>
          )}
          {field.type === 'multi_select' && (
            <>
              {' '}
              or{' '}
              <Button
                type="button"
                variant="ghost"
                className="option-row-other-link"
                onClick={() => addAllUsersAsOptions(index)}
              >
                Add all users
              </Button>
            </>
          )}
        </div>
      </div>
      <span className="builder-required">
        <Checkbox
          id={`field-shuffle-${index}`}
          checked={field.shuffleOptions}
          onCheckedChange={(checked) => updateField(index, { shuffleOptions: checked === true })}
        />
        <label htmlFor={`field-shuffle-${index}`}>
          {field.type === 'ranking' ? 'Randomize starting order' : 'Shuffle option order per respondent'}
        </label>
      </span>
    </>
  );
}

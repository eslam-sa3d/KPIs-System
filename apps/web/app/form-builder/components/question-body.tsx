'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuilderStore } from '../lib/store';
import { makeOption } from '../lib/field-defaults';
import type {
  CheckboxesField,
  DropdownField,
  FormField,
  FormSection,
  GoToTarget,
  GridField,
  LinearScaleField,
  MultipleChoiceField,
  TextValidation,
} from '../lib/types';

const GO_TO_LABELS: Record<'__next__' | '__submit__', string> = {
  __next__: 'Continue to next section',
  __submit__: 'Submit form',
};

function BranchingRow({
  target,
  sections,
  currentSectionId,
  onChange,
}: {
  target: GoToTarget | undefined;
  sections: FormSection[];
  currentSectionId: string;
  onChange: (target: GoToTarget) => void;
}) {
  const laterSections = sections.slice(sections.findIndex((s) => s.id === currentSectionId) + 1);
  return (
    <Select value={target ?? '__next__'} onValueChange={(v) => onChange(v)}>
      <SelectTrigger className="h-8 w-56 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__next__">{GO_TO_LABELS.__next__}</SelectItem>
        <SelectItem value="__submit__">{GO_TO_LABELS.__submit__}</SelectItem>
        {laterSections.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            Go to section {sections.indexOf(s) + 1} ({s.title || `Untitled section ${sections.indexOf(s) + 1}`})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Shared editor for multiple_choice / checkboxes / dropdown: an option
 *  list, "Other" write-in toggle (multiple_choice + checkboxes only), and —
 *  for multiple_choice + dropdown only — per-option "go to section" branching. */
function OptionsEditor({
  field,
  section,
  allSections,
}: {
  field: MultipleChoiceField | CheckboxesField | DropdownField;
  section: FormSection;
  allSections: FormSection[];
}) {
  const updateField = useBuilderStore((s) => s.updateField);
  const [branchingOpen, setBranchingOpen] = useState(
    field.type !== 'checkboxes' && Object.keys(field.branching).length > 0,
  );
  const supportsOther = field.type !== 'dropdown';
  const supportsBranching = field.type !== 'checkboxes';

  function setOptions(options: typeof field.options) {
    updateField(field.id, { options });
  }

  function addOption() {
    setOptions([...field.options, makeOption(field.options.length + 1)]);
  }

  function setBranchTarget(optionId: string, target: GoToTarget) {
    if (field.type === 'checkboxes') return;
    updateField(field.id, { branching: { ...field.branching, [optionId]: target } });
  }

  return (
    <div className="mt-3 space-y-2">
      {field.options.map((option, i) => (
        <div key={option.id} className="flex items-center gap-2">
          <span className="size-4 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden />
          <Input
            value={option.value}
            onChange={(e) => setOptions(field.options.map((o) => (o.id === option.id ? { ...o, value: e.target.value } : o)))}
            placeholder={`Option ${i + 1}`}
            className="h-9"
          />
          {supportsBranching && branchingOpen && (
            <BranchingRow
              target={field.branching[option.id]}
              sections={allSections}
              currentSectionId={section.id}
              onChange={(target) => setBranchTarget(option.id, target)}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove option ${i + 1}`}
            disabled={field.options.length <= 1}
            onClick={() => setOptions(field.options.filter((o) => o.id !== option.id))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={addOption}>
          <Plus className="size-4" /> Add option
        </Button>
        {supportsOther && !('allowOther' in field && field.allowOther) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => updateField(field.id, { allowOther: true })}>
            Add &quot;Other&quot;
          </Button>
        )}
      </div>

      {supportsOther && 'allowOther' in field && field.allowOther && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-4 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden />
          <span className="italic">Other…</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => updateField(field.id, { allowOther: false })}>
            remove
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={field.shuffleOptions} onCheckedChange={(v) => updateField(field.id, { shuffleOptions: v })} />
          Shuffle option order
        </label>
        {supportsBranching && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={branchingOpen} onCheckedChange={setBranchingOpen} />
            Go to section based on answer
          </label>
        )}
      </div>
    </div>
  );
}

function ValidationEditor({ field }: { field: { id: string; validation: TextValidation } }) {
  const updateField = useBuilderStore((s) => s.updateField);
  const v = field.validation;

  function patch(next: Partial<TextValidation>) {
    updateField(field.id, { validation: { ...v, ...next } });
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">Response validation</Label>
        <Select value={v.kind} onValueChange={(kind) => patch({ kind: kind as TextValidation['kind'] })}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="length">Character length</SelectItem>
            <SelectItem value="number">Number bounds</SelectItem>
            <SelectItem value="regex">Regular expression</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {v.kind === 'length' && (
        <>
          <Input type="number" className="h-9 w-28" placeholder="min length" value={v.minLength ?? ''} onChange={(e) => patch({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <Input type="number" className="h-9 w-28" placeholder="max length" value={v.maxLength ?? ''} onChange={(e) => patch({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </>
      )}
      {v.kind === 'number' && (
        <>
          <Input type="number" className="h-9 w-28" placeholder="min" value={v.min ?? ''} onChange={(e) => patch({ min: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <Input type="number" className="h-9 w-28" placeholder="max" value={v.max ?? ''} onChange={(e) => patch({ max: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <label className="flex items-center gap-2 pb-2">
            <Checkbox checked={v.integerOnly ?? false} onCheckedChange={(c) => patch({ integerOnly: c === true })} />
            Whole numbers only
          </label>
        </>
      )}
      {v.kind === 'regex' && (
        <Input className="h-9 w-56" placeholder="regular expression" value={v.pattern ?? ''} onChange={(e) => patch({ pattern: e.target.value })} />
      )}
      {v.kind !== 'none' && (
        <Input className="h-9 w-56" placeholder="custom error text" value={v.errorMessage ?? ''} onChange={(e) => patch({ errorMessage: e.target.value })} />
      )}
    </div>
  );
}

function GridEditor({ field }: { field: GridField }) {
  const updateField = useBuilderStore((s) => s.updateField);

  function setList(key: 'rows' | 'columns', list: string[]) {
    updateField(field.id, { [key]: list });
  }

  function renderList(key: 'rows' | 'columns', label: string) {
    const list = field[key];
    return (
      <div className="flex-1 space-y-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {list.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="h-9"
              value={item}
              onChange={(e) => setList(key, list.map((v, idx) => (idx === i ? e.target.value : v)))}
            />
            <Button type="button" variant="ghost" size="icon" disabled={list.length <= 1} onClick={() => setList(key, list.filter((_, idx) => idx !== i))}>
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => setList(key, [...list, `${label.slice(0, -1)} ${list.length + 1}`])}>
          <Plus className="size-4" /> Add {label.toLowerCase().slice(0, -1)}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex gap-6">
        {renderList('rows', 'Rows')}
        {renderList('columns', 'Columns')}
      </div>
      <label className="flex items-center gap-2 border-t border-border pt-3 text-sm">
        <Switch checked={field.requireOneResponsePerRow} onCheckedChange={(v) => updateField(field.id, { requireOneResponsePerRow: v })} />
        Require a response in each row
      </label>
    </div>
  );
}

function LinearScaleEditor({ field }: { field: LinearScaleField }) {
  const updateField = useBuilderStore((s) => s.updateField);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">From</Label>
        <Select value={String(field.min)} onValueChange={(v) => updateField(field.id, { min: Number(v) })}>
          <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">0</SelectItem>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">To</Label>
        <Select value={String(field.max)} onValueChange={(v) => updateField(field.id, { max: Number(v) })}>
          <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input className="h-9 w-40" placeholder={`label for ${field.min}`} value={field.minLabel} onChange={(e) => updateField(field.id, { minLabel: e.target.value })} />
      <Input className="h-9 w-40" placeholder={`label for ${field.max}`} value={field.maxLabel} onChange={(e) => updateField(field.id, { maxLabel: e.target.value })} />
    </div>
  );
}

export function QuestionBody({ field, section, allSections }: { field: FormField; section: FormSection; allSections: FormSection[] }) {
  const updateField = useBuilderStore((s) => s.updateField);

  switch (field.type) {
    case 'short_answer':
    case 'paragraph':
      return <ValidationEditor field={field} />;
    case 'multiple_choice':
    case 'checkboxes':
    case 'dropdown':
      return <OptionsEditor field={field} section={section} allSections={allSections} />;
    case 'linear_scale':
      return <LinearScaleEditor field={field} />;
    case 'multiple_choice_grid':
    case 'checkbox_grid':
      return <GridEditor field={field} />;
    case 'file_upload':
      return (
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <Input
            className="h-9 w-64"
            placeholder="allowed types, e.g. image, pdf"
            value={field.allowedTypes.join(', ')}
            onChange={(e) => updateField(field.id, { allowedTypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Max files</Label>
            <Input type="number" className="h-9 w-24" min={1} max={10} value={field.maxFiles} onChange={(e) => updateField(field.id, { maxFiles: Number(e.target.value) })} />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Max size (MB)</Label>
            <Input type="number" className="h-9 w-24" min={1} max={100} value={field.maxSizeMb} onChange={(e) => updateField(field.id, { maxSizeMb: Number(e.target.value) })} />
          </div>
        </div>
      );
    case 'date':
      return (
        <div className="mt-3 flex gap-6 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={field.includeYear} onCheckedChange={(c) => updateField(field.id, { includeYear: c === true })} /> Include year</label>
          <label className="flex items-center gap-2"><Checkbox checked={field.includeTime} onCheckedChange={(c) => updateField(field.id, { includeTime: c === true })} /> Include time</label>
        </div>
      );
    case 'time':
      return (
        <div className="mt-3 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={field.isDuration} onCheckedChange={(c) => updateField(field.id, { isDuration: c === true })} /> Duration, not time of day</label>
        </div>
      );
    case 'title_block':
      return null;
  }
}

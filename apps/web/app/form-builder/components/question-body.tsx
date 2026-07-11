'use client';

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

/** The option-row indicator glyph — matches the shape the respondent will
 *  actually see: a circle for a single answer, a square for multiple. */
function OptionMark({ type }: { type: 'multiple_choice' | 'checkboxes' | 'dropdown' }) {
  if (type === 'dropdown') return null;
  return (
    <span
      className={`size-4 shrink-0 border border-[#5f6368]/60 ${type === 'multiple_choice' ? 'rounded-full' : 'rounded-[3px]'}`}
      aria-hidden
    />
  );
}

/** Shared editor for multiple_choice / checkboxes / dropdown: an option
 *  list, "Other" write-in toggle (multiple_choice + checkboxes only), and —
 *  for multiple_choice + dropdown only — per-option "go to section" branching
 *  (revealed via the card's ⋮ menu, controlled from there). */
function OptionsEditor({
  field,
  section,
  allSections,
  branchingOpen,
}: {
  field: MultipleChoiceField | CheckboxesField | DropdownField;
  section: FormSection;
  allSections: FormSection[];
  branchingOpen: boolean;
}) {
  const updateField = useBuilderStore((s) => s.updateField);
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
    <div className="flex flex-col gap-2">
      {field.options.map((option, i) => (
        <div key={option.id} className="flex items-center gap-2">
          {field.type === 'dropdown' && <span className="w-4 shrink-0 text-sm text-[#5f6368]">{i + 1}.</span>}
          <OptionMark type={field.type} />
          <Input
            value={option.value}
            onChange={(e) => setOptions(field.options.map((o) => (o.id === option.id ? { ...o, value: e.target.value } : o)))}
            placeholder={`Option ${i + 1}`}
            className="h-9 max-w-sm border-0 border-b border-[#e0e0e0] rounded-none px-0 shadow-none focus-visible:border-[#673ab7] focus-visible:ring-0"
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
            <X className="size-4 text-[#5f6368]" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-1 pt-1 pl-6 text-sm">
        <button type="button" className="text-[#5f6368] hover:text-[#202124]" onClick={addOption}>
          Add option
        </button>
        {supportsOther && !('allowOther' in field && field.allowOther) && (
          <>
            <span className="text-[#5f6368]">or</span>
            <button
              type="button"
              className="text-[#673ab7] hover:underline"
              onClick={() => updateField(field.id, { allowOther: true })}
            >
              add &quot;Other&quot;
            </button>
          </>
        )}
      </div>

      {supportsOther && 'allowOther' in field && field.allowOther && (
        <div className="flex items-center gap-2 text-sm text-[#5f6368]">
          <OptionMark type={field.type} />
          <span className="italic">Other…</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => updateField(field.id, { allowOther: false })}>
            remove
          </Button>
        </div>
      )}
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
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Response validation</Label>
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
      <div className="flex flex-1 flex-col gap-2">
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setList(key, [...list, `${label.slice(0, -1)} ${list.length + 1}`])}
        >
          <Plus className="size-4" /> Add {label.toLowerCase().slice(0, -1)}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
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
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Select value={String(field.min)} onValueChange={(v) => updateField(field.id, { min: Number(v) })}>
          <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">0</SelectItem>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">To</Label>
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

export function QuestionBody({
  field,
  section,
  allSections,
  showValidation,
  branchingOpen,
}: {
  field: FormField;
  section: FormSection;
  allSections: FormSection[];
  /** short_answer / paragraph: whether the ⋮ menu's "Response validation" item is checked */
  showValidation: boolean;
  /** multiple_choice / dropdown: whether the ⋮ menu's "Go to section based on answer" item is checked */
  branchingOpen: boolean;
}) {
  const updateField = useBuilderStore((s) => s.updateField);

  switch (field.type) {
    case 'short_answer':
    case 'paragraph':
      return showValidation ? <ValidationEditor field={field} /> : null;
    case 'multiple_choice':
    case 'checkboxes':
    case 'dropdown':
      return <OptionsEditor field={field} section={section} allSections={allSections} branchingOpen={branchingOpen} />;
    case 'linear_scale':
      return <LinearScaleEditor field={field} />;
    case 'multiple_choice_grid':
    case 'checkbox_grid':
      return <GridEditor field={field} />;
    case 'file_upload':
      return (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <Input
            className="h-9 w-64"
            placeholder="allowed types, e.g. image, pdf"
            value={field.allowedTypes.join(', ')}
            onChange={(e) => updateField(field.id, { allowedTypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Max files</Label>
            <Input type="number" className="h-9 w-24" min={1} max={10} value={field.maxFiles} onChange={(e) => updateField(field.id, { maxFiles: Number(e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Max size (MB)</Label>
            <Input type="number" className="h-9 w-24" min={1} max={100} value={field.maxSizeMb} onChange={(e) => updateField(field.id, { maxSizeMb: Number(e.target.value) })} />
          </div>
        </div>
      );
    case 'date':
      return (
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={field.includeYear} onCheckedChange={(c) => updateField(field.id, { includeYear: c === true })} /> Include year</label>
          <label className="flex items-center gap-2"><Checkbox checked={field.includeTime} onCheckedChange={(c) => updateField(field.id, { includeTime: c === true })} /> Include time</label>
        </div>
      );
    case 'time':
      return (
        <div className="text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={field.isDuration} onCheckedChange={(c) => updateField(field.id, { isDuration: c === true })} /> Duration, not time of day</label>
        </div>
      );
    case 'title_block':
      return null;
  }
}

/**
 * Standalone Google-Forms-parity schema. Deliberately independent of
 * @pulse/contracts's FormDefinition — this module is a self-contained
 * prototype with its own local state and mock data, not wired to the real
 * forms API.
 */

export const FIELD_TYPES = [
  'short_answer',
  'paragraph',
  'multiple_choice',
  'checkboxes',
  'dropdown',
  'file_upload',
  'linear_scale',
  'multiple_choice_grid',
  'checkbox_grid',
  'date',
  'time',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface ChoiceOption {
  id: string;
  value: string;
}

/** A per-option jump target for "go to section based on answer" branching.
 *  '__next__' continues to the next section in order (the default); '__submit__'
 *  submits the form immediately. Anything else is a FormSection id. */
export type GoToTarget = '__next__' | '__submit__' | string;

export interface TextValidation {
  kind: 'none' | 'length' | 'number' | 'regex';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integerOnly?: boolean;
  pattern?: string;
  errorMessage?: string;
}

interface BaseField {
  id: string;
  title: string;
  description: string;
  required: boolean;
  /** the floating toolbar's "Add image" / "Add video" attach to whichever
   *  question is currently active, rather than inserting a separate block. */
  media?: { type: 'image' | 'video'; url: string };
}

export interface ShortAnswerField extends BaseField {
  type: 'short_answer';
  validation: TextValidation;
}

export interface ParagraphField extends BaseField {
  type: 'paragraph';
  validation: TextValidation;
}

export interface MultipleChoiceField extends BaseField {
  type: 'multiple_choice';
  options: ChoiceOption[];
  allowOther: boolean;
  shuffleOptions: boolean;
  /** optionId -> target. An option with no entry falls through normally. */
  branching: Record<string, GoToTarget>;
}

export interface CheckboxesField extends BaseField {
  type: 'checkboxes';
  options: ChoiceOption[];
  allowOther: boolean;
  shuffleOptions: boolean;
}

export interface DropdownField extends BaseField {
  type: 'dropdown';
  options: ChoiceOption[];
  shuffleOptions: boolean;
  branching: Record<string, GoToTarget>;
}

export interface FileUploadField extends BaseField {
  type: 'file_upload';
  /** free-text labels like "image", "pdf" — this module never actually uploads anything */
  allowedTypes: string[];
  maxFiles: number;
  maxSizeMb: number;
}

export interface LinearScaleField extends BaseField {
  type: 'linear_scale';
  min: 0 | 1;
  max: number;
  minLabel: string;
  maxLabel: string;
}

/** Google Forms ships "multiple choice grid" and "checkbox grid" as two
 *  separate types that differ only in whether a row takes one answer or
 *  several — same shape here, discriminated by `type`. */
export interface GridField extends BaseField {
  type: 'multiple_choice_grid' | 'checkbox_grid';
  rows: string[];
  columns: string[];
  requireOneResponsePerRow: boolean;
}

export interface DateField extends BaseField {
  type: 'date';
  includeYear: boolean;
  includeTime: boolean;
}

export interface TimeField extends BaseField {
  type: 'time';
  isDuration: boolean;
}

/** Not one of the 11 answerable input types — the toolbar's "Add title and
 *  description" inserts this display-only text block, never required. */
export interface TitleBlockField extends BaseField {
  type: 'title_block';
}

export type FormField =
  | ShortAnswerField
  | ParagraphField
  | MultipleChoiceField
  | CheckboxesField
  | DropdownField
  | FileUploadField
  | LinearScaleField
  | GridField
  | DateField
  | TimeField
  | TitleBlockField;

/** A page. Every form has at least one — Google Forms' own "Section 1" default. */
export interface FormSection {
  id: string;
  title: string;
  description: string;
  fieldIds: string[];
}

export const FORM_FONT_STYLES = ['default', 'serif', 'monospace'] as const;

export interface FormTheme {
  /** an object URL from a locally-picked file — this module has no upload backend */
  headerImageUrl: string | null;
  primaryColor: string;
  backgroundColor: string;
  fontStyle: (typeof FORM_FONT_STYLES)[number];
}

export interface FormDefinition {
  id: string;
  title: string;
  description: string;
  theme: FormTheme;
  /** keyed by id for O(1) lookups/patches during typing and drag-and-drop */
  fields: Record<string, FormField>;
  sections: FormSection[];
}

// ---- Responses (mock, client-only) ----

export type SubmissionAnswerValue =
  | string
  | string[]
  | Record<string, string>
  | Record<string, string[]>
  | null;

export interface Submission {
  id: string;
  submittedAt: string;
  /** fieldId -> answer */
  answers: Record<string, SubmissionAnswerValue>;
}

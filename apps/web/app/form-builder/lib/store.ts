import { create } from 'zustand';
import { createField, createTitleBlock, makeId } from './field-defaults';
import { MOCK_FORM } from './mock-data';
import type { ImportedSection } from './import-docx';
import type { FieldType, FormDefinition, FormField, FormSection, FormTheme } from './types';

export type EditorTab = 'questions' | 'responses';

interface BuilderState {
  form: FormDefinition;
  activeTab: EditorTab;
  activeFieldId: string | null;

  setActiveTab: (tab: EditorTab) => void;
  setActiveField: (id: string | null) => void;
  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setTheme: (patch: Partial<FormTheme>) => void;

  addField: (sectionId: string, afterFieldId: string | null, type: FieldType) => void;
  addTitleBlock: (sectionId: string, afterFieldId: string | null) => void;
  /** Patch is intentionally loose: FormField is a discriminated union, so
   *  `keyof FormField` only exposes the handful of props every variant
   *  shares — callers always sit inside a `field.type === '...'` guard
   *  already, which is where the real type safety comes from. */
  updateField: (id: string, patch: Record<string, unknown>) => void;
  duplicateField: (id: string) => void;
  removeField: (id: string) => void;
  reorderFieldInSection: (sectionId: string, fromId: string, toId: string) => void;

  /** Appends imported pages after the current ones; only fills in
   *  title/description if they're still blank, never overwrites them. */
  importSections: (imported: ImportedSection[], title?: string, description?: string) => void;
  addSection: (afterSectionId: string | null) => void;
  updateSection: (id: string, patch: Partial<Pick<FormSection, 'title' | 'description'>>) => void;
  removeSection: (id: string) => void;
  reorderSections: (fromId: string, toId: string) => void;
}

function sectionOf(form: FormDefinition, fieldId: string): FormSection | undefined {
  return form.sections.find((s) => s.fieldIds.includes(fieldId));
}

function insertField(form: FormDefinition, sectionId: string, afterFieldId: string | null, field: FormField): FormDefinition {
  const sections = form.sections.map((section) => {
    if (section.id !== sectionId) return section;
    const index = afterFieldId ? section.fieldIds.indexOf(afterFieldId) : section.fieldIds.length - 1;
    const fieldIds = [...section.fieldIds];
    fieldIds.splice(index + 1, 0, field.id);
    return { ...section, fieldIds };
  });
  return { ...form, sections, fields: { ...form.fields, [field.id]: field } };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  form: MOCK_FORM,
  activeTab: 'questions',
  activeFieldId: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveField: (id) => set({ activeFieldId: id }),
  setTitle: (title) => set((s) => ({ form: { ...s.form, title } })),
  setDescription: (description) => set((s) => ({ form: { ...s.form, description } })),
  setTheme: (patch) => set((s) => ({ form: { ...s.form, theme: { ...s.form.theme, ...patch } } })),

  addField: (sectionId, afterFieldId, type) =>
    set((s) => {
      const field = createField(type);
      return { form: insertField(s.form, sectionId, afterFieldId, field), activeFieldId: field.id };
    }),

  addTitleBlock: (sectionId, afterFieldId) =>
    set((s) => {
      const field = createTitleBlock();
      return { form: insertField(s.form, sectionId, afterFieldId, field), activeFieldId: field.id };
    }),

  updateField: (id, patch) =>
    set((s) => {
      const existing = s.form.fields[id];
      if (!existing) return s;
      return { form: { ...s.form, fields: { ...s.form.fields, [id]: { ...existing, ...patch } } } };
    }),

  duplicateField: (id) =>
    set((s) => {
      const original = s.form.fields[id];
      const section = sectionOf(s.form, id);
      if (!original || !section) return s;
      const copy = { ...original, id: makeId('field') };
      const fieldIds = [...section.fieldIds];
      fieldIds.splice(fieldIds.indexOf(id) + 1, 0, copy.id);
      return {
        form: {
          ...s.form,
          fields: { ...s.form.fields, [copy.id]: copy },
          sections: s.form.sections.map((sec) => (sec.id === section.id ? { ...sec, fieldIds } : sec)),
        },
        activeFieldId: copy.id,
      };
    }),

  removeField: (id) =>
    set((s) => {
      const { [id]: _removed, ...fields } = s.form.fields;
      return {
        form: {
          ...s.form,
          fields,
          sections: s.form.sections.map((sec) => ({
            ...sec,
            fieldIds: sec.fieldIds.filter((fid) => fid !== id),
          })),
        },
        activeFieldId: get().activeFieldId === id ? null : get().activeFieldId,
      };
    }),

  reorderFieldInSection: (sectionId, fromId, toId) =>
    set((s) => ({
      form: {
        ...s.form,
        sections: s.form.sections.map((section) => {
          if (section.id !== sectionId) return section;
          const fieldIds = [...section.fieldIds];
          const from = fieldIds.indexOf(fromId);
          const to = fieldIds.indexOf(toId);
          if (from === -1 || to === -1) return section;
          const [moved] = fieldIds.splice(from, 1);
          fieldIds.splice(to, 0, moved!);
          return { ...section, fieldIds };
        }),
      },
    })),

  importSections: (imported, title, description) =>
    set((s) => {
      const newSections: FormSection[] = imported.map((sec) => ({
        id: makeId('sec'),
        title: sec.title,
        description: '',
        fieldIds: sec.fields.map((f) => f.id),
      }));
      const newFields = Object.fromEntries(imported.flatMap((sec) => sec.fields).map((f) => [f.id, f]));
      return {
        form: {
          ...s.form,
          title: s.form.title.trim() ? s.form.title : (title ?? s.form.title),
          description: s.form.description.trim() ? s.form.description : (description ?? s.form.description),
          fields: { ...s.form.fields, ...newFields },
          sections: [...s.form.sections, ...newSections],
        },
      };
    }),

  addSection: (afterSectionId) =>
    set((s) => {
      const newSection: FormSection = { id: makeId('sec'), title: '', description: '', fieldIds: [] };
      const index = afterSectionId ? s.form.sections.findIndex((sec) => sec.id === afterSectionId) : s.form.sections.length - 1;
      const sections = [...s.form.sections];
      sections.splice(index + 1, 0, newSection);
      return { form: { ...s.form, sections } };
    }),

  updateSection: (id, patch) =>
    set((s) => ({
      form: { ...s.form, sections: s.form.sections.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)) },
    })),

  removeSection: (id) =>
    set((s) => {
      if (s.form.sections.length <= 1) return s; // a form always keeps at least one page
      const removed = s.form.sections.find((sec) => sec.id === id);
      if (!removed) return s;
      const fields = { ...s.form.fields };
      for (const fieldId of removed.fieldIds) delete fields[fieldId];
      return {
        form: { ...s.form, fields, sections: s.form.sections.filter((sec) => sec.id !== id) },
      };
    }),

  reorderSections: (fromId, toId) =>
    set((s) => {
      const sections = [...s.form.sections];
      const from = sections.findIndex((sec) => sec.id === fromId);
      const to = sections.findIndex((sec) => sec.id === toId);
      if (from === -1 || to === -1) return s;
      const [moved] = sections.splice(from, 1);
      sections.splice(to, 0, moved!);
      return { form: { ...s.form, sections } };
    }),
}));

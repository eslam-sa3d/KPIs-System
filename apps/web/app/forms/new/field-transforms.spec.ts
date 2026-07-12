import { describe, expect, it } from 'vitest';
import type { FormField } from '@pulse/contracts';
import { emptyField } from './field-transforms';
import { coerceVisibleWhenValue, fromDefinitionField, toDefinitionField, toKey } from './field-transforms';

describe('toKey', () => {
  it('slugifies a label to a lowercase, underscore-separated key', () => {
    expect(toKey('How satisfied are you?', 0)).toBe('how_satisfied_are_you');
  });

  it('strips leading/trailing punctuation and collapses runs of non-alphanumerics', () => {
    expect(toKey('  --Great!! Job--  ', 0)).toBe('great_job');
  });

  it('falls back to field_<n> when the slug would not start with a letter', () => {
    expect(toKey('123', 2)).toBe('field_3_123');
  });

  it('falls back to bare field_<n> when nothing alphanumeric remains', () => {
    expect(toKey('???', 4)).toBe('field_5');
  });

  it('truncates to 64 chars — the server-side fieldKey cap', () => {
    const longLabel = 'a'.repeat(100);
    const key = toKey(longLabel, 0);
    expect(key.length).toBeLessThanOrEqual(64);
  });
});

describe('coerceVisibleWhenValue', () => {
  it('parses gt/lt operators as numbers regardless of target field type', () => {
    expect(coerceVisibleWhenValue('5', 'gt', 'short_text')).toBe(5);
    expect(coerceVisibleWhenValue('3', 'lt', undefined)).toBe(3);
  });

  it('coerces to a real boolean for a boolean-typed target field', () => {
    expect(coerceVisibleWhenValue('true', 'equals', 'boolean')).toBe(true);
    expect(coerceVisibleWhenValue('false', 'equals', 'boolean')).toBe(false);
  });

  it('coerces to a number for number/rating/nps target fields', () => {
    expect(coerceVisibleWhenValue('7', 'equals', 'number')).toBe(7);
    expect(coerceVisibleWhenValue('4', 'equals', 'rating')).toBe(4);
    expect(coerceVisibleWhenValue('9', 'equals', 'nps')).toBe(9);
  });

  it('leaves the raw string alone for any other target type', () => {
    expect(coerceVisibleWhenValue('yes', 'equals', 'short_text')).toBe('yes');
  });
});

describe('toDefinitionField', () => {
  it('builds a select field with options, layout, and correctValue quiz scoring', () => {
    const draft = {
      ...emptyField(),
      label: 'Pick one',
      type: 'select' as const,
      options: 'A, B, C',
      points: 2,
      correctValue: 'A',
    };
    const field = toDefinitionField(draft, 0, []);
    expect(field).toMatchObject({
      key: 'pick_one',
      label: 'Pick one',
      type: 'select',
      options: [
        { value: 'A', label: 'A' },
        { value: 'B', label: 'B' },
        { value: 'C', label: 'C' },
      ],
      correctValue: 'A',
      points: 2,
    });
  });

  it('does not include correctValue when points is 0, even if a correctValue is set (quiz mode is opt-in)', () => {
    const draft = {
      ...emptyField(),
      label: 'Pick one',
      type: 'select' as const,
      options: 'A, B',
      points: 0,
      correctValue: 'A',
    };
    const field = toDefinitionField(draft, 0, []) as Record<string, unknown>;
    expect(field.correctValue).toBeUndefined();
  });

  it('builds a multi_select field with parsed correctValues', () => {
    const draft = {
      ...emptyField(),
      label: 'Pick many',
      type: 'multi_select' as const,
      options: 'A, B, C',
      points: 1,
      correctValues: 'A, C',
    };
    const field = toDefinitionField(draft, 0, []) as Record<string, unknown>;
    expect(field.correctValues).toEqual(['A', 'C']);
  });

  it('builds a grid field with rows/columns as option items', () => {
    const draft = {
      ...emptyField(),
      label: 'Matrix',
      type: 'grid' as const,
      gridRows: 'Row 1, Row 2',
      gridColumns: 'Yes, No',
    };
    const field = toDefinitionField(draft, 0, []) as Record<string, unknown>;
    expect(field.rows).toEqual([
      { value: 'Row 1', label: 'Row 1' },
      { value: 'Row 2', label: 'Row 2' },
    ]);
    expect(field.columns).toEqual([
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ]);
  });

  it('resolves visibleWhen using the coerced value against the target field type', () => {
    const draft = {
      ...emptyField(),
      label: 'Follow-up',
      type: 'short_text' as const,
      visibleWhenFieldKey: 'age',
      visibleWhenOperator: 'gt' as const,
      visibleWhenValue: '18',
    };
    const field = toDefinitionField(draft, 1, [
      { key: 'age', label: 'Age', type: 'number', options: [], scale: 5, likertScale: [] },
    ]) as Record<string, unknown>;
    expect(field.visibleWhen).toEqual({ fieldKey: 'age', operator: 'gt', equals: 18 });
  });

  it('preserves an existing key rather than regenerating one from the label (edit-mode stability)', () => {
    const draft = { ...emptyField(), key: 'original_key', label: 'Renamed label', type: 'short_text' as const };
    const field = toDefinitionField(draft, 0, []);
    expect(field.key).toBe('original_key');
  });
});

describe('fromDefinitionField / toDefinitionField round-trip', () => {
  it('round-trips a select field with quiz scoring', () => {
    const original: FormField = {
      key: 'q1',
      label: 'Best color?',
      type: 'select',
      required: true,
      layout: 'radio',
      allowOther: false,
      shuffleOptions: false,
      options: [
        { value: 'Red', label: 'Red' },
        { value: 'Blue', label: 'Blue' },
      ],
      correctValue: 'Blue',
      points: 3,
    };
    const draft = fromDefinitionField(original);
    const rebuilt = toDefinitionField(draft, 0, []);
    expect(rebuilt).toMatchObject({
      key: 'q1',
      label: 'Best color?',
      type: 'select',
      options: original.options,
      correctValue: 'Blue',
      points: 3,
    });
  });

  it('round-trips a rating field with style/labels', () => {
    const original: FormField = {
      key: 'q2',
      label: 'Rate us',
      type: 'rating',
      required: false,
      scale: 7,
      style: 'stars',
      lowLabel: 'terrible',
      highLabel: 'amazing',
    };
    const draft = fromDefinitionField(original);
    const rebuilt = toDefinitionField(draft, 0, []) as Record<string, unknown>;
    expect(rebuilt).toMatchObject({ scale: 7, style: 'stars', lowLabel: 'terrible', highLabel: 'amazing' });
  });

  it('round-trips a grid field', () => {
    const original: FormField = {
      key: 'q3',
      label: 'Rate each',
      type: 'grid',
      required: false,
      rows: [{ value: 'Speed', label: 'Speed' }],
      columns: [
        { value: 'Good', label: 'Good' },
        { value: 'Bad', label: 'Bad' },
      ],
      selection: 'single',
      requireOnePerRow: true,
    };
    const draft = fromDefinitionField(original);
    const rebuilt = toDefinitionField(draft, 0, []) as Record<string, unknown>;
    expect(rebuilt).toMatchObject({
      rows: original.rows,
      columns: original.columns,
      selection: 'single',
      requireOnePerRow: true,
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { FormField } from '@pulse/contracts';
import { describeAnswer, resolveEvaluateeId } from './score-resolution';

describe('resolveEvaluateeId', () => {
  it('resolves to the submitter when evaluateeFieldKey is unset (self-assessment)', () => {
    expect(resolveEvaluateeId(null, {}, 'user-1')).toBe('user-1');
  });

  it("resolves to the named field's answer when evaluateeFieldKey is set", () => {
    expect(resolveEvaluateeId('evaluatee', { evaluatee: 'user-2' }, 'user-1')).toBe('user-2');
  });

  it('returns null when the named field has no answer', () => {
    expect(resolveEvaluateeId('evaluatee', {}, 'user-1')).toBeNull();
  });

  it('returns null when the named field answer is not a string', () => {
    expect(resolveEvaluateeId('evaluatee', { evaluatee: 5 }, 'user-1')).toBeNull();
  });
});

describe('describeAnswer', () => {
  const rating: FormField = {
    key: 'q',
    label: 'Rate us',
    type: 'rating',
    required: true,
    scale: 5,
    style: 'pills',
  };

  it('rating: shows raw over its configured scale', () => {
    expect(describeAnswer(rating, 4)).toEqual({ raw: 4, display: '4/5' });
  });

  it('rating: rejects a non-number answer', () => {
    expect(describeAnswer(rating, 'four')).toBeNull();
  });

  it('nps: shows raw over a fixed 10', () => {
    const nps: FormField = {
      key: 'q',
      label: 'NPS',
      type: 'nps',
      required: true,
      lowLabel: 'not at all likely',
      highLabel: 'extremely likely',
    };
    expect(describeAnswer(nps, 8)).toEqual({ raw: 8, display: '8/10' });
  });

  it('slider: shows raw over its configured max', () => {
    const slider: FormField = { key: 'q', label: 'Slide', type: 'slider', required: true, min: 0, max: 100, step: 1 };
    expect(describeAnswer(slider, 42)).toEqual({ raw: 42, display: '42/100' });
  });

  it('number: shows raw alone when no max is configured', () => {
    const number: FormField = { key: 'q', label: 'Count', type: 'number', required: true, integerOnly: false };
    expect(describeAnswer(number, 7)).toEqual({ raw: 7, display: '7' });
  });

  it('number: shows raw over max when configured', () => {
    const number: FormField = { key: 'q', label: 'Count', type: 'number', required: true, integerOnly: false, max: 10 };
    expect(describeAnswer(number, 7)).toEqual({ raw: 7, display: '7/10' });
  });

  it('boolean: shows yes/no', () => {
    const boolean: FormField = { key: 'q', label: 'Yes?', type: 'boolean', required: true };
    expect(describeAnswer(boolean, true)).toEqual({ raw: true, display: 'yes' });
    expect(describeAnswer(boolean, false)).toEqual({ raw: false, display: 'no' });
  });

  it('select: shows the matched option label', () => {
    const select: FormField = {
      key: 'q',
      label: 'Pick',
      type: 'select',
      required: true,
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      layout: 'radio',
      allowOther: false,
      shuffleOptions: false,
    };
    expect(describeAnswer(select, 'b')).toEqual({ raw: 'b', display: 'Beta' });
  });

  it('select: shows the free-text answer for an "other:" value', () => {
    const select: FormField = {
      key: 'q',
      label: 'Pick',
      type: 'select',
      required: true,
      options: [{ value: 'a', label: 'Alpha' }],
      layout: 'radio',
      allowOther: true,
      shuffleOptions: false,
    };
    expect(describeAnswer(select, 'other:Gamma')).toEqual({ raw: 'other:Gamma', display: 'Gamma' });
  });

  it('select: returns null for an answer matching no option', () => {
    const select: FormField = {
      key: 'q',
      label: 'Pick',
      type: 'select',
      required: true,
      options: [{ value: 'a', label: 'Alpha' }],
      layout: 'radio',
      allowOther: false,
      shuffleOptions: false,
    };
    expect(describeAnswer(select, 'ghost')).toBeNull();
  });

  it('multi_select: joins matched option labels', () => {
    const multi: FormField = {
      key: 'q',
      label: 'Pick many',
      type: 'multi_select',
      required: true,
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      shuffleOptions: false,
      allowOther: false,
    };
    expect(describeAnswer(multi, ['a', 'b'])).toEqual({ raw: ['a', 'b'], display: 'Alpha, Beta' });
  });

  it('multi_select: reports when nothing was selected', () => {
    const multi: FormField = {
      key: 'q',
      label: 'Pick many',
      type: 'multi_select',
      required: true,
      options: [{ value: 'a', label: 'Alpha' }],
      shuffleOptions: false,
      allowOther: false,
    };
    expect(describeAnswer(multi, [])).toEqual({ raw: [], display: 'none selected' });
  });

  it('likert: joins each statement with its scale label', () => {
    const likert: FormField = {
      key: 'q',
      label: 'Rate these',
      type: 'likert',
      required: true,
      statements: [
        { value: 's1', label: 'Speed' },
        { value: 's2', label: 'Quality' },
      ],
      scale: ['disagree', 'neutral', 'agree'],
    };
    expect(describeAnswer(likert, { s1: 2, s2: 0 })).toEqual({
      raw: { s1: 2, s2: 0 },
      display: 'Speed: agree; Quality: disagree',
    });
  });

  it("performance_level: shows the resolved level's own label", () => {
    const level: FormField = { key: 'q', label: 'Level', type: 'performance_level', required: true };
    expect(describeAnswer(level, 'level-1', [{ id: 'level-1', label: 'Exceeds Expectations' }])).toEqual({
      raw: 'level-1',
      display: 'Exceeds Expectations',
    });
  });

  it('performance_level: returns null without a performanceLevels lookup', () => {
    const level: FormField = { key: 'q', label: 'Level', type: 'performance_level', required: true };
    expect(describeAnswer(level, 'level-1')).toBeNull();
  });

  it('returns null for a field type with no numeric/display interpretation', () => {
    const text: FormField = { key: 'q', label: 'Notes', type: 'short_text', required: false, maxLength: 200 };
    expect(describeAnswer(text, 'hello')).toBeNull();
  });
});

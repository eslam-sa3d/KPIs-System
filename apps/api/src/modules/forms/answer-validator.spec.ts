import { describe, expect, it } from 'vitest';
import { FormDefinition, formDefinitionSchema } from '@pulse/contracts';
import { ZodError } from 'zod';
import { compileAnswerValidator } from './answer-validator';

const definition: FormDefinition = formDefinitionSchema.parse({
  title: 'sprint health check',
  fields: [
    { key: 'team', label: 'Team', type: 'short_text', required: true },
    {
      key: 'velocity',
      label: 'Velocity',
      type: 'number',
      required: true,
      min: 0,
      max: 200,
      integerOnly: true,
    },
    {
      key: 'blocked',
      label: 'Any blockers?',
      type: 'boolean',
      required: true,
    },
    {
      key: 'blocker_detail',
      label: 'Blocker details',
      type: 'long_text',
      required: true,
      visibleWhen: { fieldKey: 'blocked', equals: true },
    },
    {
      key: 'confidence',
      label: 'Delivery confidence',
      type: 'rating',
      scale: 5,
    },
  ],
});

describe('compileAnswerValidator', () => {
  const validator = compileAnswerValidator(definition);

  it('accepts a valid submission and returns cleaned answers', () => {
    const cleaned = validator.validate({
      team: 'digital-channels',
      velocity: 42,
      blocked: false,
      confidence: 4,
    });
    expect(cleaned).toEqual({
      team: 'digital-channels',
      velocity: 42,
      blocked: false,
      confidence: 4,
    });
  });

  it('rejects missing required fields with field-level paths', () => {
    expect.assertions(2);
    try {
      validator.validate({ velocity: 42, blocked: false });
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues[0]?.path).toEqual(['team']);
    }
  });

  it('enforces numeric bounds and integer-only rules', () => {
    expect(() => validator.validate({ team: 'x', velocity: 999, blocked: false })).toThrow(
      ZodError,
    );
    expect(() => validator.validate({ team: 'x', velocity: 4.5, blocked: false })).toThrow(
      ZodError,
    );
  });

  it('requires conditionally visible fields only when their condition matches', () => {
    // blocked=true makes blocker_detail required
    expect(() => validator.validate({ team: 'x', velocity: 10, blocked: true })).toThrow(ZodError);
    // blocked=false hides it — and any smuggled answer for it is discarded
    const cleaned = validator.validate({
      team: 'x',
      velocity: 10,
      blocked: false,
      blocker_detail: 'should be dropped',
    });
    expect(cleaned).not.toHaveProperty('blocker_detail');
  });

  it('rejects answers for fields that do not exist in the form version', () => {
    expect(() =>
      validator.validate({ team: 'x', velocity: 10, blocked: false, hacked_field: 'boom' }),
    ).toThrow(ZodError);
  });

  it('caps rating answers at the configured scale', () => {
    expect(() =>
      validator.validate({ team: 'x', velocity: 10, blocked: false, confidence: 9 }),
    ).toThrow(ZodError);
  });
});

describe('v2 field types', () => {
  const v2 = compileAnswerValidator(
    formDefinitionSchema.parse({
      title: 'v2',
      fields: [
        { key: 'nps', label: 'How likely…', type: 'nps' },
        {
          key: 'mood',
          label: 'Rate these',
          type: 'likert',
          statements: [
            { value: 'tools', label: 'Tooling' },
            { value: 'pace', label: 'Pace' },
          ],
          scale: ['disagree', 'neutral', 'agree'],
        },
        {
          key: 'prio',
          label: 'Rank priorities',
          type: 'ranking',
          options: [
            { value: 'speed', label: 'Speed' },
            { value: 'cost', label: 'Cost' },
            { value: 'quality', label: 'Quality' },
          ],
        },
        {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          layout: 'radio',
          allowOther: true,
          options: [{ value: 'web', label: 'Web' }],
        },
      ],
    }),
  );

  it('validates NPS 0–10 and rejects out-of-range', () => {
    expect(v2.validate({ nps: 10 })).toEqual({ nps: 10 });
    expect(() => v2.validate({ nps: 11 })).toThrow(ZodError);
  });

  it('requires every likert statement and bounds the scale index', () => {
    expect(v2.validate({ mood: { tools: 2, pace: 0 } })).toEqual({ mood: { tools: 2, pace: 0 } });
    expect(() => v2.validate({ mood: { tools: 2 } })).toThrow(ZodError);
    expect(() => v2.validate({ mood: { tools: 3, pace: 0 } })).toThrow(ZodError);
  });

  it('accepts only complete permutations for ranking', () => {
    expect(v2.validate({ prio: ['cost', 'speed', 'quality'] })).toBeTruthy();
    expect(() => v2.validate({ prio: ['cost', 'cost', 'quality'] })).toThrow(ZodError);
    expect(() => v2.validate({ prio: ['cost', 'speed'] })).toThrow(ZodError);
  });

  it('accepts "other:" free text only when allowed', () => {
    expect(v2.validate({ channel: 'other: carrier pigeon' })).toBeTruthy();
    expect(() => v2.validate({ channel: 'fax' })).toThrow(ZodError);
  });
});

describe('formDefinitionSchema (builder-side validation)', () => {
  it('rejects duplicate field keys', () => {
    const result = formDefinitionSchema.safeParse({
      title: 'bad form',
      fields: [
        { key: 'a', label: 'A', type: 'boolean' },
        { key: 'a', label: 'A again', type: 'boolean' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects visibleWhen references to unknown fields', () => {
    const result = formDefinitionSchema.safeParse({
      title: 'bad form',
      fields: [
        {
          key: 'a',
          label: 'A',
          type: 'boolean',
          visibleWhen: { fieldKey: 'ghost', equals: true },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

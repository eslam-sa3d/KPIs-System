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

describe('response validation on text fields', () => {
  const v = compileAnswerValidator(
    formDefinitionSchema.parse({
      title: 'validated text',
      fields: [
        { key: 'code', label: 'Employee code', type: 'short_text', minLength: 4, pattern: '^[A-Z]{2}\\d{4}$' },
      ],
    }),
  );

  it('accepts an answer meeting the min length and pattern', () => {
    expect(v.validate({ code: 'AB1234' })).toEqual({ code: 'AB1234' });
  });

  it('rejects an answer failing the pattern', () => {
    expect(() => v.validate({ code: 'ab1234' })).toThrow(ZodError);
  });

  it('rejects an answer shorter than minLength', () => {
    const short = compileAnswerValidator(
      formDefinitionSchema.parse({
        title: 'min length only',
        fields: [{ key: 'x', label: 'X', type: 'short_text', minLength: 5 }],
      }),
    );
    expect(() => short.validate({ x: 'ab' })).toThrow(ZodError);
  });
});

describe('slider field', () => {
  const v = compileAnswerValidator(
    formDefinitionSchema.parse({
      title: 'slider',
      fields: [{ key: 'satisfaction', label: 'Satisfaction', type: 'slider', min: 0, max: 10, step: 1 }],
    }),
  );

  it('accepts a value within range and rejects out-of-range', () => {
    expect(v.validate({ satisfaction: 7 })).toEqual({ satisfaction: 7 });
    expect(() => v.validate({ satisfaction: 11 })).toThrow(ZodError);
  });
});

describe('contact_info field', () => {
  const v = compileAnswerValidator(
    formDefinitionSchema.parse({
      title: 'contact',
      fields: [
        {
          key: 'contact',
          label: 'Contact',
          type: 'contact_info',
          requireName: true,
          requireEmail: true,
          requirePhone: false,
        },
      ],
    }),
  );

  it('accepts name+email and allows phone to be omitted', () => {
    expect(v.validate({ contact: { name: 'Ada', email: 'ada@example.com' } })).toEqual({
      contact: { name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('rejects a missing required part or an invalid email', () => {
    expect(() => v.validate({ contact: { email: 'ada@example.com' } })).toThrow(ZodError);
    expect(() => v.validate({ contact: { name: 'Ada', email: 'not-an-email' } })).toThrow(ZodError);
  });
});

describe('hot_spot field', () => {
  const v = compileAnswerValidator(
    formDefinitionSchema.parse({
      title: 'hot spot',
      fields: [
        {
          key: 'part',
          label: 'Click the faulty part',
          type: 'hot_spot',
          imageAssetId: '11111111-1111-1111-1111-111111111111',
          regions: [
            { value: 'engine', label: 'Engine', x: 10, y: 10, width: 20, height: 20 },
            { value: 'wheel', label: 'Wheel', x: 60, y: 60, width: 15, height: 15 },
          ],
        },
      ],
    }),
  );

  it('accepts a known region value and rejects an unknown one', () => {
    expect(v.validate({ part: 'wheel' })).toEqual({ part: 'wheel' });
    expect(() => v.validate({ part: 'trunk' })).toThrow(ZodError);
  });
});

describe('rating field star style', () => {
  it('scores identically regardless of style — style is display-only', () => {
    const stars = compileAnswerValidator(
      formDefinitionSchema.parse({
        title: 'stars',
        fields: [{ key: 'r', label: 'Rate us', type: 'rating', scale: 5, style: 'stars' }],
      }),
    );
    expect(stars.validate({ r: 4 })).toEqual({ r: 4 });
    expect(() => stars.validate({ r: 6 })).toThrow(ZodError);
  });
});

describe('file field with maxFiles', () => {
  it('keeps a single upload id (not an array) when maxFiles is 1, the default', () => {
    const single = compileAnswerValidator(
      formDefinitionSchema.parse({
        title: 'single upload',
        fields: [{ key: 'receipt', label: 'Receipt', type: 'file', acceptedMimeTypes: ['application/pdf'] }],
      }),
    );
    expect(single.validate({ receipt: 'upload-1' })).toEqual({ receipt: 'upload-1' });
    expect(() => single.validate({ receipt: ['upload-1'] })).toThrow(ZodError);
  });

  it('accepts an array of upload ids up to maxFiles, and rejects over the cap', () => {
    const multi = compileAnswerValidator(
      formDefinitionSchema.parse({
        title: 'multi upload',
        fields: [
          { key: 'photos', label: 'Photos', type: 'file', acceptedMimeTypes: ['image/png'], maxFiles: 3 },
        ],
      }),
    );
    expect(multi.validate({ photos: ['a', 'b'] })).toEqual({ photos: ['a', 'b'] });
    expect(() => multi.validate({ photos: ['a', 'b', 'c', 'd'] })).toThrow(ZodError);
    expect(() => multi.validate({ photos: [] })).toThrow(ZodError); // at least one required when present
  });
});

describe('section_header field', () => {
  it('is display-only: never required, never stored, and rejects any submitted value', () => {
    const withHeader = compileAnswerValidator(
      formDefinitionSchema.parse({
        title: 'with a heading',
        fields: [
          { key: 'intro', label: 'Section one', type: 'section_header' },
          { key: 'name', label: 'Name', type: 'short_text', required: true },
        ],
      }),
    );
    expect(withHeader.validate({ name: 'Ada' })).toEqual({ name: 'Ada' });
    expect(() => withHeader.validate({ intro: 'unexpected', name: 'Ada' })).toThrow(ZodError);
  });

  it('rejects a required section_header at the definition level', () => {
    expect(() =>
      formDefinitionSchema.parse({
        title: 'invalid',
        fields: [{ key: 'intro', label: 'Section one', type: 'section_header', required: true }],
      }),
    ).toThrow(ZodError);
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

  it('accepts a {{field_key}} piping reference to an earlier field', () => {
    const result = formDefinitionSchema.safeParse({
      title: 'piped form',
      fields: [
        { key: 'name', label: 'Your name', type: 'short_text' },
        { key: 'greeting', label: 'Nice to meet you, {{name}}!', type: 'boolean' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a {{field_key}} piping reference to an unknown field', () => {
    const result = formDefinitionSchema.safeParse({
      title: 'bad piped form',
      fields: [{ key: 'greeting', label: 'Nice to meet you, {{ghost}}!', type: 'boolean' }],
    });
    expect(result.success).toBe(false);
  });

});

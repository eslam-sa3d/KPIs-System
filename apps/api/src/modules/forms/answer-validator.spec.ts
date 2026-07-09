import { describe, expect, it } from 'vitest';
import { END_OF_FORM, FormDefinition, formDefinitionSchema } from '@pulse/contracts';
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

describe('section branching', () => {
  const branchedDefinition: FormDefinition = formDefinitionSchema.parse({
    title: 'branching survey',
    fields: [
      {
        key: 'segment',
        label: 'Which segment are you in?',
        type: 'select',
        options: [
          { value: 'enterprise', label: 'Enterprise' },
          { value: 'smb', label: 'SMB' },
        ],
      },
      { key: 'seats', label: 'Seat count', type: 'number', required: true },
      { key: 'budget', label: 'Monthly budget', type: 'number', required: true },
      { key: 'name', label: 'Your name', type: 'short_text', required: true },
    ],
    sections: [
      {
        id: 'intro',
        fieldKeys: ['segment'],
        branching: {
          onFieldKey: 'segment',
          cases: [
            { equals: 'enterprise', goTo: 'enterprise_path' },
            { equals: 'smb', goTo: 'smb_path' },
          ],
        },
      },
      // enterprise_path unconditionally jumps past smb_path straight to outro
      { id: 'enterprise_path', fieldKeys: ['seats'], branching: { defaultGoTo: 'outro' } },
      // smb_path has no rule — falls through to the next section in array order (outro)
      { id: 'smb_path', fieldKeys: ['budget'] },
      { id: 'outro', fieldKeys: ['name'] },
    ],
  });

  const validator = compileAnswerValidator(branchedDefinition);

  it('requires only the fields on the branch path actually taken', () => {
    const cleaned = validator.validate({ segment: 'enterprise', seats: 50, name: 'Ada' });
    expect(cleaned).toEqual({ segment: 'enterprise', seats: 50, name: 'Ada' });
  });

  it('drops answers smuggled in for a section the branch skipped, without requiring them', () => {
    const cleaned = validator.validate({
      segment: 'enterprise',
      seats: 50,
      name: 'Ada',
      budget: 999, // smb_path was never reached — must be dropped, not required elsewhere
    });
    expect(cleaned).not.toHaveProperty('budget');
  });

  it('requires the field on the OTHER branch when that path is taken instead', () => {
    expect(() => validator.validate({ segment: 'smb', name: 'Bo' })).toThrow(ZodError);
    const cleaned = validator.validate({ segment: 'smb', budget: 200, name: 'Bo' });
    expect(cleaned).toEqual({ segment: 'smb', budget: 200, name: 'Bo' });
  });
});

describe('branchRules (multiple rules per page, expanded trigger types)', () => {
  const definition: FormDefinition = formDefinitionSchema.parse({
    title: 'multi-rule branching',
    fields: [
      { key: 'vip', label: 'VIP customer?', type: 'boolean' },
      {
        key: 'tier',
        label: 'Tier',
        type: 'select',
        options: [
          { value: 'gold', label: 'Gold' },
          { value: 'silver', label: 'Silver' },
        ],
      },
      { key: 'name', label: 'Your name', type: 'short_text', required: true },
      // each path gets its own exclusive field — a field can only belong to one section
      { key: 'vip_note', label: 'VIP note', type: 'short_text' },
      { key: 'gold_note', label: 'Gold note', type: 'short_text' },
      { key: 'standard_note', label: 'Standard note', type: 'short_text' },
    ],
    sections: [
      {
        id: 'intro',
        fieldKeys: ['vip', 'tier'],
        // two independent rules on the SAME page, keying off two different fields —
        // impossible with the old single `branching` field
        branchRules: [
          { onFieldKey: 'vip', cases: [{ equals: 'true', goTo: 'vip_path' }] },
          { onFieldKey: 'tier', cases: [{ equals: 'gold', goTo: 'gold_path' }], defaultGoTo: 'standard_path' },
        ],
      },
      { id: 'vip_path', fieldKeys: ['vip_note'], branching: { defaultGoTo: 'outro' } },
      { id: 'gold_path', fieldKeys: ['gold_note'], branching: { defaultGoTo: 'outro' } },
      { id: 'standard_path', fieldKeys: ['standard_note'], branching: { defaultGoTo: 'outro' } },
      { id: 'outro', fieldKeys: ['name'] },
    ],
  });
  const validator = compileAnswerValidator(definition);

  it('the first rule to produce a target wins, regardless of later rules', () => {
    // vip=true matches rule 1 outright — rule 2 (tier) never even considered
    expect(validator.validate({ vip: true, tier: 'silver', name: 'A' })).toEqual({
      vip: true,
      tier: 'silver',
      name: 'A',
    });
  });

  it('falls through to the next rule when an earlier rule has no match and no default', () => {
    // vip=false: rule 1 has no matching case and no defaultGoTo, so rule 2 (tier=gold) decides
    expect(validator.validate({ vip: false, tier: 'gold', name: 'A' })).toEqual({
      vip: false,
      tier: 'gold',
      name: 'A',
    });
  });

  it("a later rule's own defaultGoTo still fires when none of its cases match", () => {
    // vip=false, tier=silver: neither rule's cases match, but rule 2 has a defaultGoTo
    expect(validator.validate({ vip: false, tier: 'silver', name: 'A' })).toEqual({
      vip: false,
      tier: 'silver',
      name: 'A',
    });
  });

  it('boolean and number fields are valid branch triggers (stringified exact match)', () => {
    const numberTriggered: FormDefinition = formDefinitionSchema.parse({
      title: 'number trigger',
      fields: [
        { key: 'age', label: 'Age', type: 'number', required: true },
        { key: 'guardian_name', label: 'Guardian name', type: 'short_text', required: true },
        { key: 'name', label: 'Name', type: 'short_text', required: true },
      ],
      sections: [
        {
          id: 'age_gate',
          fieldKeys: ['age'],
          branchRules: [{ onFieldKey: 'age', cases: [{ equals: '17', goTo: 'minor' }], defaultGoTo: 'adult' }],
        },
        // minor path ends here (no cascade into "adult"'s fields)
        { id: 'minor', fieldKeys: ['guardian_name'], branching: { defaultGoTo: END_OF_FORM } },
        { id: 'adult', fieldKeys: ['name'] },
      ],
    });
    const v = compileAnswerValidator(numberTriggered);
    expect(v.validate({ age: 17, guardian_name: 'Sam' })).toEqual({ age: 17, guardian_name: 'Sam' });
    expect(v.validate({ age: 30, name: 'Ada' })).toEqual({ age: 30, name: 'Ada' });
  });

  it('rejects a branchRules trigger of an unbranchable type (ranking)', () => {
    expect(() =>
      formDefinitionSchema.parse({
        title: 'invalid trigger',
        fields: [
          { key: 'prio', label: 'Rank', type: 'ranking', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
          { key: 'name', label: 'Name', type: 'short_text' },
        ],
        sections: [
          { id: 'p1', fieldKeys: ['prio'], branchRules: [{ onFieldKey: 'prio', defaultGoTo: 'p2' }] },
          { id: 'p2', fieldKeys: ['name'] },
        ],
      }),
    ).toThrow(ZodError);
  });
});

describe('section branching off a rating field', () => {
  const definition: FormDefinition = formDefinitionSchema.parse({
    title: 'satisfaction follow-up',
    fields: [
      { key: 'happiness', label: 'How happy are you?', type: 'rating', scale: 5 },
      { key: 'praise', label: 'What did we do well?', type: 'short_text', required: true },
      { key: 'complaint', label: 'What went wrong?', type: 'short_text', required: true },
    ],
    sections: [
      {
        id: 'intro',
        fieldKeys: ['happiness'],
        branching: {
          onFieldKey: 'happiness',
          cases: [
            { equals: '5', goTo: 'happy_path' },
            { equals: '4', goTo: 'happy_path' },
          ],
          defaultGoTo: 'unhappy_path',
        },
      },
      // each branch is terminal here (no shared trailing page) — an explicit
      // defaultGoTo of "end" is what keeps it from falling through into its sibling
      { id: 'happy_path', fieldKeys: ['praise'], branching: { defaultGoTo: END_OF_FORM } },
      { id: 'unhappy_path', fieldKeys: ['complaint'], branching: { defaultGoTo: END_OF_FORM } },
    ],
  });
  const validator = compileAnswerValidator(definition);

  it('routes a high score to the happy path and requires only its field', () => {
    const cleaned = validator.validate({ happiness: 5, praise: 'fast support' });
    expect(cleaned).toEqual({ happiness: 5, praise: 'fast support' });
  });

  it('falls back to the default target for a low score, requiring the OTHER field', () => {
    expect(() => validator.validate({ happiness: 2, praise: 'n/a' })).toThrow(ZodError);
    const cleaned = validator.validate({ happiness: 2, complaint: 'slow response' });
    expect(cleaned).toEqual({ happiness: 2, complaint: 'slow response' });
  });
});

describe('section branching off a likert statement', () => {
  const definition: FormDefinition = formDefinitionSchema.parse({
    title: 'sprint retro',
    fields: [
      {
        key: 'mood',
        label: 'Rate these',
        type: 'likert',
        statements: [
          { value: 'pace', label: 'Pace' },
          { value: 'tools', label: 'Tooling' },
        ],
        scale: ['disagree', 'neutral', 'agree'],
      },
      { key: 'pace_detail', label: 'Tell us about the pace', type: 'short_text', required: true },
    ],
    sections: [
      {
        id: 'intro',
        fieldKeys: ['mood'],
        branching: {
          onFieldKey: 'mood',
          onStatement: 'pace',
          cases: [{ equals: '0', goTo: 'pace_followup' }], // index 0 = "disagree"
          defaultGoTo: END_OF_FORM,
        },
      },
      { id: 'pace_followup', fieldKeys: ['pace_detail'] },
    ],
  });
  const validator = compileAnswerValidator(definition);

  it('branches on the named statement\'s scale index, ignoring other statements', () => {
    const cleaned = validator.validate({
      mood: { pace: 0, tools: 2 },
      pace_detail: 'sprint felt rushed',
    });
    expect(cleaned).toEqual({ mood: { pace: 0, tools: 2 }, pace_detail: 'sprint felt rushed' });
  });

  it('skips the follow-up section (and its required field) when the statement does not match', () => {
    const cleaned = validator.validate({ mood: { pace: 2, tools: 0 } });
    expect(cleaned).not.toHaveProperty('pace_detail');
  });
});

describe('section branching off a multi_select field (includes semantics)', () => {
  const definition: FormDefinition = formDefinitionSchema.parse({
    title: 'tooling survey',
    fields: [
      {
        key: 'tools_used',
        label: 'Which tools do you use?',
        type: 'multi_select',
        options: [
          { value: 'figma', label: 'Figma' },
          { value: 'jira', label: 'Jira' },
          { value: 'slack', label: 'Slack' },
        ],
      },
      { key: 'jira_feedback', label: 'What do you think of Jira?', type: 'short_text', required: true },
    ],
    sections: [
      {
        id: 'intro',
        fieldKeys: ['tools_used'],
        branching: {
          onFieldKey: 'tools_used',
          cases: [{ equals: 'jira', goTo: 'jira_followup' }],
          defaultGoTo: END_OF_FORM,
        },
      },
      { id: 'jira_followup', fieldKeys: ['jira_feedback'] },
    ],
  });
  const validator = compileAnswerValidator(definition);

  it('follows the case when the selections include the matched option, ignoring the rest', () => {
    const cleaned = validator.validate({
      tools_used: ['figma', 'jira', 'slack'],
      jira_feedback: 'love it',
    });
    expect(cleaned).toEqual({ tools_used: ['figma', 'jira', 'slack'], jira_feedback: 'love it' });
  });

  it('ends the form when the selections do not include the matched option', () => {
    const cleaned = validator.validate({ tools_used: ['figma', 'slack'] });
    expect(cleaned).not.toHaveProperty('jira_feedback');
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

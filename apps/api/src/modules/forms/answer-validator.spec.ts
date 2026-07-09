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

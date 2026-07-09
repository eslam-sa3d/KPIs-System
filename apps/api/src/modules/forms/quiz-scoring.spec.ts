import { describe, expect, it } from 'vitest';
import { FormDefinition, formDefinitionSchema } from '@pulse/contracts';
import { scoreSubmission } from './quiz-scoring';

const quiz: FormDefinition = formDefinitionSchema.parse({
  title: 'geography quiz',
  fields: [
    {
      key: 'capital',
      label: 'Capital of France?',
      type: 'select',
      options: [
        { value: 'paris', label: 'Paris' },
        { value: 'lyon', label: 'Lyon' },
      ],
      correctValue: 'paris',
      points: 2,
    },
    {
      key: 'oceans',
      label: 'Which are oceans?',
      type: 'multi_select',
      options: [
        { value: 'pacific', label: 'Pacific' },
        { value: 'atlantic', label: 'Atlantic' },
        { value: 'sahara', label: 'Sahara' },
      ],
      correctValues: ['pacific', 'atlantic'],
      points: 2,
    },
    {
      key: 'round',
      label: 'Earth is round?',
      type: 'boolean',
      correctValue: true,
      points: 1,
    },
    {
      key: 'author',
      label: 'Who wrote Hamlet?',
      type: 'short_text',
      correctAnswers: ['Shakespeare', 'William Shakespeare'],
      points: 3,
    },
    {
      key: 'moons',
      label: 'How many moons does Mars have?',
      type: 'number',
      correctValue: 2,
      points: 2,
    },
    // no correctValue/points at all — not gradable, ignored by scoring
    { key: 'comments', label: 'Any comments?', type: 'long_text' },
  ],
});

describe('scoreSubmission', () => {
  it('awards full points for an all-correct submission', () => {
    const score = scoreSubmission(quiz, {
      capital: 'paris',
      oceans: ['pacific', 'atlantic'],
      round: true,
      author: 'shakespeare', // case-insensitive match
      moons: 2,
    });
    expect(score).toEqual({ earnedPoints: 10, totalPoints: 10, percent: 100, passed: null });
  });

  it('gives partial credit and rounds the percent', () => {
    const score = scoreSubmission(quiz, {
      capital: 'lyon', // wrong (0/2)
      oceans: ['pacific', 'atlantic'], // right (2/2)
      round: true, // right (1/1)
      author: 'Marlowe', // wrong (0/3)
      moons: 2, // right (2/2)
    });
    // 5 of 10 points => 50%
    expect(score).toMatchObject({ earnedPoints: 5, totalPoints: 10, percent: 50 });
  });

  it('multi_select requires an exact set match, order-independent', () => {
    const partial = scoreSubmission(quiz, { oceans: ['pacific'] });
    const wrongOrder = scoreSubmission(quiz, { oceans: ['atlantic', 'pacific'] });
    const withExtra = scoreSubmission(quiz, { oceans: ['pacific', 'atlantic', 'sahara'] });
    expect(partial!.earnedPoints).toBe(0);
    expect(wrongOrder!.earnedPoints).toBeGreaterThanOrEqual(2); // order doesn't matter
    expect(withExtra!.earnedPoints).toBe(0); // extra wrong option breaks the exact-set match
  });

  it('computes pass/fail against a threshold when one is provided', () => {
    const passing = scoreSubmission(quiz, { capital: 'paris', oceans: ['pacific', 'atlantic'], round: true, author: 'Shakespeare', moons: 2 }, 70);
    const failing = scoreSubmission(quiz, {}, 70);
    expect(passing!.passed).toBe(true);
    expect(failing!.passed).toBe(false);
  });

  it('passed is null when no threshold is configured', () => {
    const score = scoreSubmission(quiz, { capital: 'paris' });
    expect(score!.passed).toBeNull();
  });

  it('returns null entirely for a form with no gradable fields', () => {
    const plain: FormDefinition = formDefinitionSchema.parse({
      title: 'plain form',
      fields: [{ key: 'name', label: 'Name', type: 'short_text' }],
    });
    expect(scoreSubmission(plain, { name: 'Ada' })).toBeNull();
  });

  it('an unanswered gradable question counts as wrong, not skipped', () => {
    const score = scoreSubmission(quiz, { capital: 'paris' });
    expect(score!.totalPoints).toBe(10); // every gradable field still counts toward the total
    expect(score!.earnedPoints).toBe(2); // only the answered-and-correct one is credited
  });
});

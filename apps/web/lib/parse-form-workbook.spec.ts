import { describe, expect, it } from 'vitest';
import { mapRowsToFields, parseCsvText, parseDocxLines } from './parse-form-workbook';

describe('parseCsvText', () => {
  it('splits simple comma-separated rows', () => {
    expect(parseCsvText('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsvText('name,note\n"Smith, John",ok')).toEqual([
      ['name', 'note'],
      ['Smith, John', 'ok'],
    ]);
  });

  it('handles quoted fields containing embedded newlines', () => {
    expect(parseCsvText('label\n"Line one\nLine two"')).toEqual([['label'], ['Line one\nLine two']]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsvText('quip\n"She said ""hi"""')).toEqual([['quip'], ['She said "hi"']]);
  });

  it('strips carriage returns from CRLF line endings', () => {
    expect(parseCsvText('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('mapRowsToFields', () => {
  it('reports an error when there are no rows at all', () => {
    const result = mapRowsToFields([]);
    expect(result.fields).toEqual([]);
    expect(result.issues).toEqual(['the file has no rows']);
  });

  it('requires a recognizable "question" column', () => {
    const result = mapRowsToFields([['foo', 'bar']]);
    expect(result.issues).toEqual(['missing required column — the header row needs a "question" column']);
  });

  it('matches column headers case/spacing-insensitively against aliases', () => {
    const result = mapRowsToFields([
      ['  Question  ', 'Field Type', 'Mandatory'],
      ['How are you?', 'rating', 'yes'],
    ]);
    expect(result.fields).toEqual([expect.objectContaining({ label: 'How are you?', type: 'rating', required: true })]);
  });

  it('skips a fully blank row silently, but reports an issue for a row with other data and no question text', () => {
    const result = mapRowsToFields([
      ['question', 'required'],
      ['', ''], // fully blank — skipped silently
      ['', 'yes'], // has data, but no question text — reported
      ['Real question', ''],
    ]);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.label).toBe('Real question');
    expect(result.issues).toEqual(['row 3: no question text, skipped']);
  });

  it('defaults an unrecognized type alias to short_text rather than failing', () => {
    const result = mapRowsToFields([
      ['question', 'type'],
      ['Q1', 'some made-up type'],
    ]);
    expect(result.fields[0]!.type).toBe('short_text');
  });

  it('clamps out-of-range scale/maxSizeMb to the fallback default', () => {
    const result = mapRowsToFields([
      ['question', 'scale', 'max file size mb'],
      ['Q1', '999', '-5'],
    ]);
    expect(result.fields[0]!.scale).toBe(5); // 999 is outside [2,10]
    expect(result.fields[0]!.maxSizeMb).toBe(10); // -5 is outside [1,25]
  });

  it('reports "no questions found" only when there were no other issues either', () => {
    const onlyBlankRows = mapRowsToFields([['question'], ['']]);
    expect(onlyBlankRows.issues).toEqual(['no questions found in the file']);

    const withSkippedRow = mapRowsToFields([
      ['question', 'foo'],
      ['', 'bar'],
    ]);
    expect(withSkippedRow.issues).toEqual(['row 2: no question text, skipped']);
  });
});

describe('parseDocxLines', () => {
  it('extracts a title and description preceding the first numbered question', () => {
    const doc = ['My Form Title', 'A short description.', '1. First question'].join('\n');
    const result = parseDocxLines(doc);
    expect(result.title).toBe('My Form Title');
    expect(result.description).toBe('A short description.');
    expect(result.fields).toHaveLength(1);
  });

  it('turns a numbered question with 2+ lettered options into a select field', () => {
    const doc = ['1. Pick one', 'a. Option A', 'b. Option B'].join('\n');
    const result = parseDocxLines(doc);
    expect(result.fields[0]).toMatchObject({ type: 'select', options: 'Option A, Option B' });
  });

  it('turns a numbered question with no options into a short_text field', () => {
    const doc = '1. Just answer this';
    const result = parseDocxLines(doc);
    expect(result.fields[0]).toMatchObject({ type: 'short_text', label: 'Just answer this' });
  });

  it('splits a trailing parenthetical into help text', () => {
    const doc = '1. Full name (as it appears on your ID)';
    const result = parseDocxLines(doc);
    expect(result.fields[0]).toMatchObject({ label: 'Full name', helpText: 'as it appears on your ID' });
  });

  it('groups a SECTION-marked rating-scale question and its continuations into one likert field', () => {
    const doc = [
      '1. SECTION 1 - Leadership: Coaching & Mentoring',
      'a. 1 - Needs Improvement',
      'b. 2 - Meets',
      'c. 3 - Exceeds',
      'd. 4 - Excellent',
      '2. Communication',
      'a. 1 - Needs Improvement',
      'b. 2 - Meets',
      'c. 3 - Exceeds',
      'd. 4 - Excellent',
      '3. What can we improve?',
    ].join('\n');
    const result = parseDocxLines(doc);
    const likert = result.fields.find((f) => f.type === 'likert');
    expect(likert).toBeDefined();
    expect(likert!.label).toBe('Leadership');
    expect(likert!.options).toBe('Coaching & Mentoring, Communication');
    expect(likert!.likertScale).toBe('1 - Needs Improvement, 2 - Meets, 3 - Exceeds, 4 - Excellent');
    // the trailing free-text question is a separate, non-likert field after the group
    expect(result.fields.find((f) => f.label === 'What can we improve?')).toMatchObject({ type: 'short_text' });
  });

  it('reports an issue when no question lines are found at all', () => {
    const result = parseDocxLines('just some prose\nwith no numbered lines');
    expect(result.fields).toEqual([]);
    expect(result.issues).toEqual(['no question lines found in the document']);
  });

  it('reports an issue for genuinely empty content', () => {
    const result = parseDocxLines('   \n  \n');
    expect(result.issues).toEqual(['the document has no content']);
  });
});

import { makeId } from './field-defaults';
import type { FormField } from './types';

export interface ImportedSection {
  title: string;
  fields: FormField[];
}

export interface ImportResult {
  title?: string;
  description?: string;
  sections: ImportedSection[];
  issues: string[];
}

const NUMBERED_LINE = /^\d+\.\s+(.*)$/;
const LETTERED_LINE = /^[a-zA-Z]\.\s+(.*)$/;
/** "SECTION 1 - Test Design & Coverage: Test Case Design Quality (...)" —
 *  everything up to the first colon after "SECTION N" names the new page;
 *  the rest of the line is that question's own title, same as any other. */
const SECTION_PREFIX = /^SECTION\s+\d+\s*[-–—]\s*([^:]+):\s*(.*)$/i;
/** a help-text aside in parentheses at the very end of the line */
const TRAILING_HELP_TEXT = /^(.*?)\s*\(([^()]*)\)\s*$/;
const OPEN_ENDED_HINT = /comment|feedback|describe|explain|additional|observation|note/i;

function splitTitleAndHelp(text: string): { title: string; helpText: string } {
  const m = text.match(TRAILING_HELP_TEXT);
  return m ? { title: m[1]!.trim(), helpText: m[2]!.trim() } : { title: text.trim(), helpText: '' };
}

function finalizeQuestion(rawTitle: string, options: string[]): FormField {
  const { title, helpText } = splitTitleAndHelp(rawTitle);
  const base = { id: makeId('field'), title, description: helpText, required: false };

  if (options.length >= 2) {
    return {
      ...base,
      type: 'multiple_choice',
      options: options.map((value) => ({ id: makeId('opt'), value })),
      allowOther: false,
      shuffleOptions: false,
      branching: {},
    };
  }

  return {
    ...base,
    type: OPEN_ENDED_HINT.test(title) || OPEN_ENDED_HINT.test(helpText) ? 'paragraph' : 'short_answer',
    validation: { kind: 'none' },
  };
}

/**
 * Parses a "QA Evaluation Forms"-style .docx: a title line, a description
 * line, then a flat run of "N. Question (help text)" lines each optionally
 * followed by "a. Option" / "b. Option" lettered choices. A question whose
 * text starts with "SECTION N - Page Name:" begins a new page (that
 * question is the first one on it); everything before the first such marker
 * lands on an implicit opening page. Two or more lettered options makes a
 * multiple_choice question; zero or one makes a short_answer (or paragraph,
 * for open-ended-sounding prompts like "additional comments").
 */
export function parseQaEvaluationDocx(rawText: string): ImportResult {
  const issues: string[] = [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { sections: [], issues: ['the document has no content'] };

  let i = 0;
  let title: string | undefined;
  let description: string | undefined;

  if (!NUMBERED_LINE.test(lines[0]!) && !LETTERED_LINE.test(lines[0]!)) {
    title = lines[i++];
    if (i < lines.length && !NUMBERED_LINE.test(lines[i]!) && !LETTERED_LINE.test(lines[i]!)) {
      description = lines[i++];
    }
  }

  const sections: ImportedSection[] = [{ title: 'Section 1', fields: [] }];
  let currentQuestion: string | null = null;
  let currentOptions: string[] = [];

  function flush() {
    if (currentQuestion === null) return;
    sections[sections.length - 1]!.fields.push(finalizeQuestion(currentQuestion, currentOptions));
    currentQuestion = null;
    currentOptions = [];
  }

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const numbered = line.match(NUMBERED_LINE);
    const lettered = !numbered ? line.match(LETTERED_LINE) : null;

    if (numbered) {
      flush();
      let text = numbered[1]!;
      const sectionMatch = text.match(SECTION_PREFIX);
      if (sectionMatch) {
        sections.push({ title: sectionMatch[1]!.trim(), fields: [] });
        text = sectionMatch[2]!;
      }
      currentQuestion = text;
    } else if (lettered) {
      if (currentQuestion === null) {
        issues.push(`option "${lettered[1]}" appears before any question — skipped`);
      } else {
        currentOptions.push(lettered[1]!.trim());
      }
    } else {
      issues.push(`unrecognized line, ignored: "${line.slice(0, 60)}"`);
    }
  }
  flush();

  const nonEmptySections = sections.filter((s) => s.fields.length > 0);
  if (nonEmptySections.length === 0) issues.push('no numbered questions found');

  return { title, description, sections: nonEmptySections, issues };
}

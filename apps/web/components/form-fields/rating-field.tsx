import type { FormField, SubmissionAnswers } from '@pulse/contracts';

export function RatingField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'rating' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const current = value as number | undefined;
  if (field.style === 'stars') {
    return (
      <div className="scale-row star-row" role="radiogroup" aria-labelledby={`${id}-label`} id={id}>
        {field.lowLabel && <span className="muted scale-cap">{field.lowLabel}</span>}
        {Array.from({ length: field.scale }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className={`star-pill${current !== undefined && n <= current ? ' star-pill-active' : ''}`}
            onClick={() => onChange(n)}
          >
            ★
          </button>
        ))}
        {field.highLabel && <span className="muted scale-cap">{field.highLabel}</span>}
      </div>
    );
  }
  return (
    <div className="scale-row" role="radiogroup" aria-labelledby={`${id}-label`} id={id}>
      {field.lowLabel && <span className="muted scale-cap">{field.lowLabel}</span>}
      {Array.from({ length: field.scale }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={current === n}
          className={`scale-pill${current === n ? ' scale-pill-active' : ''}`}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      {field.highLabel && <span className="muted scale-cap">{field.highLabel}</span>}
    </div>
  );
}

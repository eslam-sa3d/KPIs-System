import type { FormField, SubmissionAnswers } from '@pulse/contracts';

export function LikertField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'likert' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const current = (value as Record<string, number> | undefined) ?? {};
  return (
    <div className="likert" id={id} role="table">
      <div className="likert-row likert-head" role="row">
        <span role="columnheader" />
        {field.scale.map((s) => (
          <span key={s} role="columnheader" className="muted">
            {s}
          </span>
        ))}
      </div>
      {field.statements.map((st) => (
        <div key={st.value} className="likert-row" role="row">
          <span role="rowheader">{st.label}</span>
          {field.scale.map((s, idx) => (
            <span key={s} role="cell">
              <input
                type="radio"
                name={`${id}-${st.value}`}
                aria-label={`${st.label}: ${s}`}
                checked={current[st.value] === idx}
                onChange={() => onChange({ ...current, [st.value]: idx })}
              />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

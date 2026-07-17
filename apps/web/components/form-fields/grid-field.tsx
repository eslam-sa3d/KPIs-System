import type { FormField, SubmissionAnswers } from '@pulse/contracts';

export function GridField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'grid' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const current = (value as Record<string, string | string[]> | undefined) ?? {};
  const isMultiple = field.selection === 'multiple';
  return (
    <div className="likert" id={id} role="table">
      <div className="likert-row likert-head" role="row">
        <span role="columnheader" />
        {field.columns.map((c) => (
          <span key={c.value} role="columnheader" className="muted">
            {c.label}
          </span>
        ))}
      </div>
      {field.rows.map((row) => {
        const rowAnswer = current[row.value];
        const rowSelected = isMultiple
          ? ((rowAnswer as string[] | undefined) ?? [])
          : (rowAnswer as string | undefined);
        return (
          <div key={row.value} className="likert-row" role="row">
            <span role="rowheader">{row.label}</span>
            {field.columns.map((c) => (
              <span key={c.value} role="cell">
                <input
                  type={isMultiple ? 'checkbox' : 'radio'}
                  name={isMultiple ? undefined : `${id}-${row.value}`}
                  aria-label={`${row.label}: ${c.label}`}
                  checked={isMultiple ? (rowSelected as string[]).includes(c.value) : rowSelected === c.value}
                  onChange={(e) => {
                    if (isMultiple) {
                      const list = (rowSelected as string[]) ?? [];
                      onChange({
                        ...current,
                        [row.value]: e.target.checked ? [...list, c.value] : list.filter((v) => v !== c.value),
                      } as Record<string, string[]>);
                    } else {
                      onChange({ ...current, [row.value]: c.value } as Record<string, string>);
                    }
                  }}
                />
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

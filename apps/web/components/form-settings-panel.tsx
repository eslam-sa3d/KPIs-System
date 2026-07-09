'use client';

import { FormEvent, useState } from 'react';
import type { FormSettings } from '@pulse/contracts';
import { api } from '../lib/api-client';

const toLocalInputValue = (iso?: string) => (iso ? iso.slice(0, 16) : '');
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

/** MS-Forms-style settings: accept responses, schedule, one-per-user, shuffle, thank-you text. */
export function FormSettingsPanel({
  formId,
  settings,
  onSaved,
}: {
  formId: string;
  settings: FormSettings;
  onSaved: (next: FormSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api<FormSettings>(`/v1/forms/${formId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      });
      onSaved(saved);
      setNotice('settings saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saving settings failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-card builder" onSubmit={onSave}>
      <h2>response settings</h2>

      <label className="check-item">
        <input
          type="checkbox"
          checked={draft.acceptingResponses}
          onChange={(e) => setDraft((d) => ({ ...d, acceptingResponses: e.target.checked }))}
        />
        accepting responses
      </label>

      <label htmlFor="fs-opens">opens at (optional)</label>
      <input
        id="fs-opens"
        type="datetime-local"
        value={toLocalInputValue(draft.opensAt)}
        onChange={(e) => setDraft((d) => ({ ...d, opensAt: toIso(e.target.value) }))}
      />

      <label htmlFor="fs-closes">closes at (optional)</label>
      <input
        id="fs-closes"
        type="datetime-local"
        value={toLocalInputValue(draft.closesAt)}
        onChange={(e) => setDraft((d) => ({ ...d, closesAt: toIso(e.target.value) }))}
      />

      <label className="check-item">
        <input
          type="checkbox"
          checked={draft.oneResponsePerUser}
          onChange={(e) => setDraft((d) => ({ ...d, oneResponsePerUser: e.target.checked }))}
        />
        limit to one response per person (signed-in users by account, anonymous respondents by browser)
      </label>

      <label className="check-item">
        <input
          type="checkbox"
          checked={draft.shuffleQuestions}
          onChange={(e) => setDraft((d) => ({ ...d, shuffleQuestions: e.target.checked }))}
        />
        shuffle question order per respondent
      </label>

      <label className="check-item">
        <input
          type="checkbox"
          checked={draft.shuffleSections}
          onChange={(e) => setDraft((d) => ({ ...d, shuffleSections: e.target.checked }))}
        />
        shuffle page order per respondent (only takes effect on forms whose pages have no branching rules)
      </label>

      <label htmlFor="fs-max-responses">stop accepting responses after (optional)</label>
      <input
        id="fs-max-responses"
        type="number"
        min={1}
        value={draft.maxResponses ?? ''}
        onChange={(e) =>
          setDraft((d) => ({ ...d, maxResponses: e.target.value === '' ? undefined : Number(e.target.value) }))
        }
        placeholder="no limit"
      />

      <label>response quotas (optional)</label>
      <p className="muted" style={{ fontSize: 11, margin: '2px 0 8px' }}>
        stop counting a specific answer once it hits its own limit — e.g. close after 50 responses
        where role = manager — independent of the blanket limit above.
      </p>
      {draft.quotas.map((quota, i) => (
        <div key={i} className="builder-required" style={{ flexWrap: 'wrap' }}>
          <input
            aria-label="field key"
            value={quota.fieldKey}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                quotas: d.quotas.map((q, qi) => (qi === i ? { ...q, fieldKey: e.target.value } : q)),
              }))
            }
            placeholder="field key"
          />
          <input
            aria-label="equals"
            value={quota.equals}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                quotas: d.quotas.map((q, qi) => (qi === i ? { ...q, equals: e.target.value } : q)),
              }))
            }
            placeholder="answer value"
          />
          <input
            aria-label="limit"
            type="number"
            min={1}
            value={quota.limit}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                quotas: d.quotas.map((q, qi) => (qi === i ? { ...q, limit: Number(e.target.value) } : q)),
              }))
            }
            placeholder="limit"
          />
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setDraft((d) => ({ ...d, quotas: d.quotas.filter((_, qi) => qi !== i) }))}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost"
        onClick={() =>
          setDraft((d) => ({ ...d, quotas: [...d.quotas, { fieldKey: '', equals: '', limit: 50 }] }))
        }
      >
        + add quota
      </button>

      <label className="check-item">
        <input
          type="checkbox"
          checked={draft.allowRespondentEdit}
          onChange={(e) => setDraft((d) => ({ ...d, allowRespondentEdit: e.target.checked }))}
        />
        let respondents edit their own response via a link shown after submitting
      </label>

      <label className="check-item">
        <input
          type="checkbox"
          checked={draft.quizMode}
          onChange={(e) => setDraft((d) => ({ ...d, quizMode: e.target.checked }))}
        />
        quiz mode — score responses against each question's correct answer
      </label>

      {draft.quizMode && (
        <>
          <label htmlFor="fs-pass-threshold">pass threshold, % of points (optional)</label>
          <input
            id="fs-pass-threshold"
            type="number"
            min={0}
            max={100}
            value={draft.passThresholdPercent ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                passThresholdPercent: e.target.value === '' ? undefined : Number(e.target.value),
              }))
            }
            placeholder="no threshold"
          />

          <label className="check-item">
            <input
              type="checkbox"
              checked={draft.showScoreToRespondent}
              onChange={(e) => setDraft((d) => ({ ...d, showScoreToRespondent: e.target.checked }))}
            />
            show the score to the respondent after they submit
          </label>
        </>
      )}

      <label htmlFor="fs-thanks">thank-you message</label>
      <input
        id="fs-thanks"
        value={draft.thankYouMessage}
        maxLength={500}
        onChange={(e) => setDraft((d) => ({ ...d, thankYouMessage: e.target.value }))}
      />

      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? 'saving…' : 'save settings'}
      </button>
      {notice && <p className="form-notice">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

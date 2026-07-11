'use client';

import { FormEvent, useState } from 'react';
import type { FormSettings } from '@pulse/contracts';
import { api } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

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
    <Card>
      <CardContent className="pt-6">
    <form className="builder" onSubmit={onSave}>
      <h2 className="text-lg font-semibold mb-2">response settings</h2>

      <span className="builder-required">
        <Checkbox
          id="fs-accepting"
          checked={draft.acceptingResponses}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, acceptingResponses: checked === true }))}
        />
        <label htmlFor="fs-accepting">accepting responses</label>
      </span>

      <label htmlFor="fs-opens">opens at (optional)</label>
      <Input
        id="fs-opens"
        type="datetime-local"
        value={toLocalInputValue(draft.opensAt)}
        onChange={(e) => setDraft((d) => ({ ...d, opensAt: toIso(e.target.value) }))}
      />

      <label htmlFor="fs-closes">closes at (optional)</label>
      <Input
        id="fs-closes"
        type="datetime-local"
        value={toLocalInputValue(draft.closesAt)}
        onChange={(e) => setDraft((d) => ({ ...d, closesAt: toIso(e.target.value) }))}
      />

      <span className="builder-required">
        <Checkbox
          id="fs-one-per-user"
          checked={draft.oneResponsePerUser}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, oneResponsePerUser: checked === true }))}
        />
        <label htmlFor="fs-one-per-user">
          limit to one response per person (signed-in users by account, anonymous respondents by browser)
        </label>
      </span>

      <span className="builder-required">
        <Checkbox
          id="fs-shuffle-questions"
          checked={draft.shuffleQuestions}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, shuffleQuestions: checked === true }))}
        />
        <label htmlFor="fs-shuffle-questions">shuffle question order per respondent</label>
      </span>

      <span className="builder-required">
        <Checkbox
          id="fs-shuffle-sections"
          checked={draft.shuffleSections}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, shuffleSections: checked === true }))}
        />
        <label htmlFor="fs-shuffle-sections">
          shuffle page order per respondent (only takes effect on forms whose pages have no branching rules)
        </label>
      </span>

      <label htmlFor="fs-max-responses">stop accepting responses after (optional)</label>
      <Input
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
          <Input
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
          <Input
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
          <Input
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDraft((d) => ({ ...d, quotas: d.quotas.filter((_, qi) => qi !== i) }))}
          >
            remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          setDraft((d) => ({ ...d, quotas: [...d.quotas, { fieldKey: '', equals: '', limit: 50 }] }))
        }
      >
        + add quota
      </Button>

      <span className="builder-required">
        <Checkbox
          id="fs-allow-edit"
          checked={draft.allowRespondentEdit}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, allowRespondentEdit: checked === true }))}
        />
        <label htmlFor="fs-allow-edit">let respondents edit their own response via a link shown after submitting</label>
      </span>

      <span className="builder-required">
        <Checkbox
          id="fs-captcha"
          checked={draft.requireCaptcha}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, requireCaptcha: checked === true }))}
        />
        <label htmlFor="fs-captcha">
          require a CAPTCHA check on public link submissions (Cloudflare Turnstile — needs
          TURNSTILE_SECRET_KEY / NEXT_PUBLIC_TURNSTILE_SITE_KEY configured to take effect)
        </label>
      </span>

      <label htmlFor="fs-webhook">webhook URL (optional)</label>
      <Input
        id="fs-webhook"
        type="url"
        value={draft.webhookUrl ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, webhookUrl: e.target.value === '' ? undefined : e.target.value }))}
        placeholder="https://example.com/hooks/pulse-forms"
      />
      <p className="muted" style={{ fontSize: 11, margin: '2px 0 8px' }}>
        every new response is POSTed here as JSON ({'{formSlug, submissionId, answers, score, createdAt}'});
        delivery failures are logged and never block the submission.
      </p>

      <span className="builder-required">
        <Checkbox
          id="fs-quiz-mode"
          checked={draft.quizMode}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, quizMode: checked === true }))}
        />
        <label htmlFor="fs-quiz-mode">quiz mode — score responses against each question's correct answer</label>
      </span>

      {draft.quizMode && (
        <>
          <label htmlFor="fs-pass-threshold">pass threshold, % of points (optional)</label>
          <Input
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

          <span className="builder-required">
            <Checkbox
              id="fs-show-score"
              checked={draft.showScoreToRespondent}
              onCheckedChange={(checked) => setDraft((d) => ({ ...d, showScoreToRespondent: checked === true }))}
            />
            <label htmlFor="fs-show-score">show the score to the respondent after they submit</label>
          </span>
        </>
      )}

      <label htmlFor="fs-thanks">thank-you message</label>
      <Input
        id="fs-thanks"
        value={draft.thankYouMessage}
        maxLength={500}
        onChange={(e) => setDraft((d) => ({ ...d, thankYouMessage: e.target.value }))}
      />

      <Button type="submit" disabled={busy}>
        {busy ? 'saving…' : 'save settings'}
      </Button>
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
      </CardContent>
    </Card>
  );
}

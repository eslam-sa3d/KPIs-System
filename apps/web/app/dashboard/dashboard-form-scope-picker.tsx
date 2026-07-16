'use client';

import type { DashboardFormScope, FormListItem } from '@pulse/contracts';
import { FormMultiSelectCombobox } from '../../components/form-multi-select-combobox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Which forms' submissions currently feed the dashboard, plus the
 *  admin-only picker to change it — global, shared across every user (see
 *  DashboardFormScope). The error alert renders whenever a save fails,
 *  independent of whether the picker card itself is visible. */
export function DashboardFormScopePicker({
  canSeeTeamOverview,
  formScope,
  scopeForms,
  selectedFormIds,
  canEditFormScope,
  onToggleScopeForm,
  formScopeSaving,
  onShowAllForms,
  formScopeError,
}: {
  canSeeTeamOverview: boolean;
  formScope: DashboardFormScope | null;
  scopeForms: FormListItem[] | null;
  selectedFormIds: Set<string>;
  canEditFormScope: boolean;
  onToggleScopeForm: (form: FormListItem) => void;
  formScopeSaving: boolean;
  onShowAllForms: () => void;
  formScopeError: string | null;
}) {
  return (
    <>
      {canSeeTeamOverview && (
        <div
          className="p-card"
          style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
        >
          <span className="muted">
            Showing data from:{' '}
            {formScope === null
              ? 'Loading…'
              : selectedFormIds.size === 0
                ? 'All forms'
                : [...selectedFormIds].map((id) => scopeForms?.find((f) => f.id === id)?.title ?? id).join(', ')}
          </span>
          {canEditFormScope && (
            <>
              <FormMultiSelectCombobox
                selectedIds={selectedFormIds}
                onToggle={onToggleScopeForm}
                disabled={formScopeSaving}
                triggerLabel="Choose a form"
              />
              {selectedFormIds.size > 0 && (
                <Button type="button" variant="ghost" size="sm" disabled={formScopeSaving} onClick={onShowAllForms}>
                  Show all forms
                </Button>
              )}
              {formScopeSaving && <Spinner className="size-4" />}
            </>
          )}
        </div>
      )}
      {formScopeError && (
        <Alert variant="destructive" style={{ marginBottom: 16 }}>
          <AlertDescription>{formScopeError}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

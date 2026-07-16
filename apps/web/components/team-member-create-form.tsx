import { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DepartmentRow, JobTitleRow, RoleRow } from './team-members-manager';

/** The "New user" creation panel — shown in place of the New user button
 *  while creatingUser is true. */
export function TeamMemberCreateForm({
  departments,
  jobTitles,
  roles,
  onCreate,
  onCancel,
}: {
  departments: DepartmentRow[];
  jobTitles: JobTitleRow[];
  roles: RoleRow[];
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <form className="builder" onSubmit={onCreate}>
          <h2 className="text-lg font-semibold mb-2">New user</h2>
          <label htmlFor="u-email">Email</label>
          <Input id="u-email" name="email" type="email" required />
          <label htmlFor="u-name">Display name</label>
          <Input id="u-name" name="displayName" required minLength={2} />
          <label htmlFor="u-pass">Temporary password</label>
          <Input id="u-pass" name="password" type="password" required minLength={8} />
          {departments.length > 0 && (
            <>
              <label htmlFor="u-dept">Department</label>
              {/* Radix Select renders a hidden native <select> in sync with its
                  value when given a `name`, so this still participates in the
                  surrounding form's FormData on submit like a native <select>. */}
              <Select name="departmentId">
                <SelectTrigger id="u-dept">
                  <SelectValue placeholder="— none —" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {jobTitles.length > 0 && (
            <>
              <label htmlFor="u-job-title">Job title</label>
              <Select name="jobTitleId">
                <SelectTrigger id="u-job-title">
                  <SelectValue placeholder="— none —" />
                </SelectTrigger>
                <SelectContent>
                  {jobTitles.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {roles.length > 0 && (
            <>
              <span className="field-label">Roles</span>
              <span className="check-group">
                {roles.map((r) => (
                  <label key={r.id} className="check-item">
                    <Checkbox name="roleIds" value={r.id} /> {r.name}
                  </label>
                ))}
              </span>
            </>
          )}
          <span className="check-group">
            <label className="check-item">
              <Checkbox name="isKpiApplicable" defaultChecked /> KPI applicable
            </label>
          </span>
          <span className="row-actions">
            <Button type="submit">Create user</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </span>
        </form>
      </CardContent>
    </Card>
  );
}

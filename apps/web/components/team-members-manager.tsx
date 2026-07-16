'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser, PaginationMeta } from '@pulse/contracts';
import { can } from './portal-shell';
import { TeamMemberCreateForm } from './team-member-create-form';
import { TeamMemberResetPasswordDialog } from './team-member-reset-password-dialog';
import { TeamMemberStats } from './team-member-stats';
import { TeamMembersTable } from './team-members-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiPaged, api } from '../lib/api-client';

const PAGE_SIZE = 25;
// Keystrokes settle before firing a request, so typing a name doesn't
// spray a request per character at the users:read endpoint.
const SEARCH_DEBOUNCE_MS = 300;

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isKpiApplicable: boolean;
  department: { id: string; name: string } | null;
  jobTitle: { id: string; label: string } | null;
  roles: Array<{ id: string; name: string }>;
}

export interface RoleRow {
  id: string;
  name: string;
}

export interface DepartmentRow {
  id: string;
  name: string;
}

export interface JobTitleRow {
  id: string;
  label: string;
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  departments: number;
  assignedToDepartment: number;
}

/** Create accounts, assign roles, and manage access tiers — shared between
 *  the standalone /admin/users page and the settings "team members" tab. */
export function TeamMembersManager({ user }: { user: AuthenticatedUser | null }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [pendingRoleIds, setPendingRoleIds] = useState<Set<string>>(new Set());
  const [savingRoles, setSavingRoles] = useState(false);
  const [resetPasswordRow, setResetPasswordRow] = useState<UserRow | null>(null);
  const [resetPasswordDraft, setResetPasswordDraft] = useState({ newPassword: '', confirmPassword: '' });
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [editingInfoId, setEditingInfoId] = useState<string | null>(null);
  const [infoDraft, setInfoDraft] = useState({
    displayName: '',
    email: '',
    departmentId: '',
    jobTitleId: '',
    isKpiApplicable: true,
  });
  const [savingInfo, setSavingInfo] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);

  // Headline counts, not derived from the current (possibly filtered/paginated)
  // page — reloaded whenever a mutation could move total/active/inactive counts.
  const reloadStats = useCallback(() => api<UserStats>('/v1/users/stats').then(setStats), []);

  useEffect(() => {
    if (!user) return;
    void reloadStats();
  }, [user, reloadStats]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A new filter should always land back on page 1 — otherwise "filtered by
  // X" can silently show "no results" just because the previous page number
  // no longer has that many filtered rows.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, departmentFilter]);

  const reload = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (departmentFilter) params.set('departmentId', departmentFilter);
    return apiPaged<UserRow[]>(`/v1/users?${params.toString()}`).then(({ data, pagination: meta }) => {
      setUsers(data);
      setPagination(meta);
    });
  }, [page, debouncedSearch, departmentFilter]);

  useEffect(() => {
    if (!user) return;
    void reload();
  }, [user, reload]);

  useEffect(() => {
    if (!user) return;
    if (can(user, 'roles:view')) void api<RoleRow[]>('/v1/roles').then(setRoles);
    if (can(user, 'departments:view')) void api<DepartmentRow[]>('/v1/departments').then(setDepartments);
    if (can(user, 'configuration:view')) void api<JobTitleRow[]>('/v1/job-titles').then(setJobTitles);
  }, [user]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api('/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          displayName: form.get('displayName'),
          password: form.get('password'),
          departmentId: form.get('departmentId') || undefined,
          jobTitleId: form.get('jobTitleId') || undefined,
          roleIds: form.getAll('roleIds'),
          isKpiApplicable: form.get('isKpiApplicable') === 'on',
        }),
      });
      (event.target as HTMLFormElement).reset();
      setNotice('User created');
      setCreatingUser(false);
      // New users sort first (createdAt desc) — jump to page 1 so the one
      // just created is actually visible instead of landing on whatever
      // page was open before. Reload directly when already there, since
      // setPage(1) is a no-op and wouldn't otherwise re-trigger the fetch.
      if (page === 1) await reload();
      else setPage(1);
      void reloadStats();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the user failed');
    }
  }

  async function onToggleStatus(row: UserRow) {
    setError(null);
    try {
      await api(`/v1/users/${row.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await reload();
      void reloadStats();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating status failed');
    }
  }

  function onStartResetPassword(row: UserRow) {
    setError(null);
    setResetPasswordError(null);
    setResetPasswordDraft({ newPassword: '', confirmPassword: '' });
    setResetPasswordRow(row);
  }

  function onCancelResetPassword() {
    setResetPasswordRow(null);
  }

  /** Admin sets the account's new password directly (same "temporary password,
   *  must change at next login" semantics as creating a user) — no email round
   *  trip, so this works for a deactivated account too. */
  async function onSubmitResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetPasswordRow) return;
    if (resetPasswordDraft.newPassword !== resetPasswordDraft.confirmPassword) {
      setResetPasswordError("New passwords don't match");
      return;
    }
    setResetPasswordError(null);
    setResetPasswordBusy(true);
    try {
      await api(`/v1/users/${resetPasswordRow.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: resetPasswordDraft.newPassword }),
      });
      setNotice(`Password reset for ${resetPasswordRow.email}`);
      setResetPasswordRow(null);
    } catch (cause) {
      setResetPasswordError(cause instanceof Error ? cause.message : 'Resetting the password failed');
    } finally {
      setResetPasswordBusy(false);
    }
  }

  function onStartEditRoles(row: UserRow) {
    setError(null);
    setEditingUserId(row.id);
    setPendingRoleIds(new Set(row.roles.map((r) => r.id)));
  }

  function onCancelEditRoles() {
    setEditingUserId(null);
    setPendingRoleIds(new Set());
  }

  function onTogglePendingRole(roleId: string) {
    setPendingRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  async function onSaveRoles(row: UserRow) {
    setError(null);
    setSavingRoles(true);
    try {
      const current = new Set(row.roles.map((r) => r.id));
      const toAdd = [...pendingRoleIds].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !pendingRoleIds.has(id));
      await Promise.all([
        ...toAdd.map((roleId) => api(`/v1/roles/${roleId}/users/${row.id}`, { method: 'POST' })),
        ...toRemove.map((roleId) => api(`/v1/roles/${roleId}/users/${row.id}`, { method: 'DELETE' })),
      ]);
      setEditingUserId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating roles failed');
    } finally {
      setSavingRoles(false);
    }
  }

  function onStartEditInfo(row: UserRow) {
    setError(null);
    setEditingInfoId(row.id);
    setInfoDraft({
      displayName: row.displayName,
      email: row.email,
      departmentId: row.department?.id ?? '',
      jobTitleId: row.jobTitle?.id ?? '',
      isKpiApplicable: row.isKpiApplicable,
    });
  }

  function onCancelEditInfo() {
    setEditingInfoId(null);
  }

  async function onSaveInfo(row: UserRow) {
    setError(null);
    setSavingInfo(true);
    try {
      await api(`/v1/users/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: infoDraft.displayName,
          email: infoDraft.email,
          departmentId: infoDraft.departmentId || null,
          jobTitleId: infoDraft.jobTitleId || null,
          isKpiApplicable: infoDraft.isKpiApplicable,
        }),
      });
      setEditingInfoId(null);
      await reload();
      void reloadStats(); // department reassignment moves the "assigned" count
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the user failed');
    } finally {
      setSavingInfo(false);
    }
  }

  const canEditRoles = can(user, 'roles:edit') && can(user, 'users:edit');
  const canEditUsers = can(user, 'users:edit');
  const canToggleUserStatus = can(user, 'users:activate_deactivate');

  return (
    <div>
      <TeamMemberStats stats={stats} />

      {canEditUsers && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
          {!creatingUser && <Button onClick={() => setCreatingUser(true)}>New user</Button>}
        </div>
      )}

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

      {canEditUsers && creatingUser && (
        <TeamMemberCreateForm
          departments={departments}
          jobTitles={jobTitles}
          roles={roles}
          onCreate={onCreate}
          onCancel={() => setCreatingUser(false)}
        />
      )}

      <TeamMembersTable
        users={users}
        pagination={pagination}
        search={search}
        setSearch={setSearch}
        debouncedSearch={debouncedSearch}
        departmentFilter={departmentFilter}
        setDepartmentFilter={setDepartmentFilter}
        departments={departments}
        jobTitles={jobTitles}
        roles={roles}
        editingInfoId={editingInfoId}
        infoDraft={infoDraft}
        setInfoDraft={setInfoDraft}
        savingInfo={savingInfo}
        onSaveInfo={onSaveInfo}
        onCancelEditInfo={onCancelEditInfo}
        onStartEditInfo={onStartEditInfo}
        editingUserId={editingUserId}
        pendingRoleIds={pendingRoleIds}
        onTogglePendingRole={onTogglePendingRole}
        savingRoles={savingRoles}
        onSaveRoles={onSaveRoles}
        onCancelEditRoles={onCancelEditRoles}
        onStartEditRoles={onStartEditRoles}
        onStartResetPassword={onStartResetPassword}
        onToggleStatus={onToggleStatus}
        canEditUsers={canEditUsers}
        canEditRoles={canEditRoles}
        canToggleUserStatus={canToggleUserStatus}
        setPage={setPage}
      />

      <TeamMemberResetPasswordDialog
        row={resetPasswordRow}
        draft={resetPasswordDraft}
        setDraft={setResetPasswordDraft}
        error={resetPasswordError}
        busy={resetPasswordBusy}
        onCancel={onCancelResetPassword}
        onSubmit={onSubmitResetPassword}
      />
    </div>
  );
}

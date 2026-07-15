'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Building2, UserCheck, UserX, Users as UsersIcon } from 'lucide-react';
import type { AuthenticatedUser, PaginationMeta } from '@pulse/contracts';
import { can } from './portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiPaged, api } from '../lib/api-client';
import { useReveal } from '../lib/use-reveal';

const PAGE_SIZE = 25;
// Keystrokes settle before firing a request, so typing a name doesn't
// spray a request per character at the users:read endpoint.
const SEARCH_DEBOUNCE_MS = 300;

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isKpiApplicable: boolean;
  department: { id: string; name: string } | null;
  jobTitle: { id: string; label: string } | null;
  roles: Array<{ id: string; name: string }>;
}

interface RoleRow {
  id: string;
  name: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface JobTitleRow {
  id: string;
  label: string;
}

interface UserStats {
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
      setNotice('user created');
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

  const scopeRef = useReveal<HTMLDivElement>('.insight-card, tbody tr', users !== null && users.length > 0);

  return (
    <div ref={scopeRef}>
      {stats && (
        <div className="insights-row">
          <div className="insight-card tone-purple">
            <span className="hierarchy-icon hierarchy-icon-sm">
              <UsersIcon size={15} aria-hidden="true" />
            </span>
            <span className="insight-card-body">
              <strong>{stats.total}</strong>
              <span>{stats.total === 1 ? 'user' : 'users'}</span>
            </span>
          </div>
          <div className="insight-card tone-blue">
            <span className="hierarchy-icon hierarchy-icon-sm">
              <Building2 size={15} aria-hidden="true" />
            </span>
            <span className="insight-card-body">
              <strong>{stats.departments}</strong>
              <span>
                {stats.departments === 1 ? 'department' : 'departments'} · {stats.assignedToDepartment} assigned
              </span>
            </span>
          </div>
          <div className="insight-card tone-green">
            <span className="hierarchy-icon hierarchy-icon-sm">
              <UserCheck size={15} aria-hidden="true" />
            </span>
            <span className="insight-card-body">
              <strong>{stats.active}</strong>
              <span>activated</span>
            </span>
          </div>
          <div className="insight-card tone-amber">
            <span className="hierarchy-icon hierarchy-icon-sm">
              <UserX size={15} aria-hidden="true" />
            </span>
            <span className="insight-card-body">
              <strong>{stats.inactive}</strong>
              <span>deactivated</span>
            </span>
          </div>
        </div>
      )}

      {canEditUsers && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
          {!creatingUser && <Button onClick={() => setCreatingUser(true)}>new user</Button>}
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
        <Card>
          <CardContent className="pt-6">
            <form className="builder" onSubmit={onCreate}>
              <h2 className="text-lg font-semibold mb-2">new user</h2>
              <label htmlFor="u-email">email</label>
              <Input id="u-email" name="email" type="email" required />
              <label htmlFor="u-name">display name</label>
              <Input id="u-name" name="displayName" required minLength={2} />
              <label htmlFor="u-pass">temporary password</label>
              <Input id="u-pass" name="password" type="password" required minLength={8} />
              {departments.length > 0 && (
                <>
                  <label htmlFor="u-dept">department</label>
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
                  <label htmlFor="u-job-title">job title</label>
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
                  <span className="field-label">roles</span>
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
                <Button type="submit">create user</Button>
                <Button type="button" variant="ghost" onClick={() => setCreatingUser(false)}>
                  cancel
                </Button>
              </span>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="page-title-row">
        <Input
          aria-label="search users"
          placeholder="search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {departments.length > 0 && (
          <Select
            value={departmentFilter || '__all__'}
            onValueChange={(v) => setDepartmentFilter(v === '__all__' ? '' : v)}
          >
            <SelectTrigger aria-label="filter by department" className="w-[180px]">
              <SelectValue placeholder="all departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">all departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {users === null ? (
        <LoadingState />
      ) : users.length === 0 ? (
        <div className="empty-state">
          {debouncedSearch || departmentFilter ? (
            <>
              <h2>no users match</h2>
              <p className="muted">try a different search term or department.</p>
            </>
          ) : (
            <>
              <h2>no users yet</h2>
              <p className="muted">create the first account above to start granting access.</p>
            </>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>name</TableHead>
              <TableHead>email</TableHead>
              <TableHead>department</TableHead>
              <TableHead>job title</TableHead>
              <TableHead>roles</TableHead>
              <TableHead>status</TableHead>
              <TableHead>KPI applicable</TableHead>
              {(canToggleUserStatus || canEditUsers || canEditRoles) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Input
                      aria-label="display name"
                      value={infoDraft.displayName}
                      onChange={(e) => setInfoDraft((d) => ({ ...d, displayName: e.target.value }))}
                    />
                  ) : (
                    row.displayName
                  )}
                </TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Input
                      aria-label="email"
                      type="email"
                      value={infoDraft.email}
                      onChange={(e) => setInfoDraft((d) => ({ ...d, email: e.target.value }))}
                    />
                  ) : (
                    row.email
                  )}
                </TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Select
                      value={infoDraft.departmentId || '__none__'}
                      onValueChange={(v) => setInfoDraft((d) => ({ ...d, departmentId: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger aria-label="department" size="sm" className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    (row.department?.name ?? '—')
                  )}
                </TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Select
                      value={infoDraft.jobTitleId || '__none__'}
                      onValueChange={(v) => setInfoDraft((d) => ({ ...d, jobTitleId: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger aria-label="job title" size="sm" className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {jobTitles.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    (row.jobTitle?.label ?? '—')
                  )}
                </TableCell>
                <TableCell>
                  {editingUserId === row.id ? (
                    <span className="check-group">
                      {roles.map((r) => (
                        <label key={r.id} className="check-item">
                          <Checkbox
                            checked={pendingRoleIds.has(r.id)}
                            onCheckedChange={() => onTogglePendingRole(r.id)}
                          />{' '}
                          {r.name}
                        </label>
                      ))}
                    </span>
                  ) : (
                    row.roles.map((r) => r.name).join(', ') || '—'
                  )}
                </TableCell>
                <TableCell>{row.isActive ? 'active' : 'deactivated'}</TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Checkbox
                      aria-label="KPI applicable"
                      checked={infoDraft.isKpiApplicable}
                      onCheckedChange={(v) => setInfoDraft((d) => ({ ...d, isKpiApplicable: v === true }))}
                    />
                  ) : row.isKpiApplicable ? (
                    'yes'
                  ) : (
                    'no'
                  )}
                </TableCell>
                {(canToggleUserStatus || canEditUsers || canEditRoles) && (
                  <TableCell>
                    <span className="builder-field-actions">
                      {canEditUsers &&
                        (editingInfoId === row.id ? (
                          <>
                            <Button size="sm" disabled={savingInfo} onClick={() => onSaveInfo(row)}>
                              save info
                            </Button>
                            <Button variant="ghost" size="sm" disabled={savingInfo} onClick={onCancelEditInfo}>
                              cancel
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onStartEditInfo(row)}>
                            edit
                          </Button>
                        ))}
                      {canToggleUserStatus && (
                        <Button variant="ghost" size="sm" onClick={() => onToggleStatus(row)}>
                          {row.isActive ? 'deactivate' : 'activate'}
                        </Button>
                      )}
                      {canEditRoles &&
                        (editingUserId === row.id ? (
                          <>
                            <Button size="sm" disabled={savingRoles} onClick={() => onSaveRoles(row)}>
                              save roles
                            </Button>
                            <Button variant="ghost" size="sm" disabled={savingRoles} onClick={onCancelEditRoles}>
                              cancel
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onStartEditRoles(row)}>
                            change role
                          </Button>
                        ))}
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pagination && pagination.totalItems > 0 && (
        <div className="page-title-row" aria-label="users pagination">
          <span className="muted">
            showing {(pagination.page - 1) * pagination.pageSize + 1}
            {'–'}
            {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
          </span>
          <span className="row-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              previous
            </Button>
            <span className="muted">
              page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            >
              next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

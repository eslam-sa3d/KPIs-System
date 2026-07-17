import { Dispatch, SetStateAction } from 'react';
import { MoreVertical } from 'lucide-react';
import type { PaginationMeta } from '@pulse/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DepartmentRow, JobTitleRow, RoleRow, UserRow } from './team-members-manager';

/** Search/filter controls, the users table with its inline per-row roles/info
 *  editing, and pagination — everything below the insight cards and the
 *  create-user panel. */
export function TeamMembersTable({
  users,
  pagination,
  search,
  setSearch,
  debouncedSearch,
  departmentFilter,
  setDepartmentFilter,
  departments,
  jobTitles,
  roles,
  editingInfoId,
  infoDraft,
  setInfoDraft,
  savingInfo,
  onSaveInfo,
  onCancelEditInfo,
  onStartEditInfo,
  editingUserId,
  pendingRoleIds,
  onTogglePendingRole,
  savingRoles,
  onSaveRoles,
  onCancelEditRoles,
  onStartEditRoles,
  onStartResetPassword,
  onToggleStatus,
  canEditUsers,
  canEditRoles,
  canToggleUserStatus,
  setPage,
}: {
  users: UserRow[] | null;
  pagination: PaginationMeta | null;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  debouncedSearch: string;
  departmentFilter: string;
  setDepartmentFilter: Dispatch<SetStateAction<string>>;
  departments: DepartmentRow[];
  jobTitles: JobTitleRow[];
  roles: RoleRow[];
  editingInfoId: string | null;
  infoDraft: {
    displayName: string;
    email: string;
    departmentId: string;
    jobTitleId: string;
    isKpiApplicable: boolean;
  };
  setInfoDraft: Dispatch<
    SetStateAction<{
      displayName: string;
      email: string;
      departmentId: string;
      jobTitleId: string;
      isKpiApplicable: boolean;
    }>
  >;
  savingInfo: boolean;
  onSaveInfo: (row: UserRow) => void;
  onCancelEditInfo: () => void;
  onStartEditInfo: (row: UserRow) => void;
  editingUserId: string | null;
  pendingRoleIds: Set<string>;
  onTogglePendingRole: (roleId: string) => void;
  savingRoles: boolean;
  onSaveRoles: (row: UserRow) => void;
  onCancelEditRoles: () => void;
  onStartEditRoles: (row: UserRow) => void;
  onStartResetPassword: (row: UserRow) => void;
  onToggleStatus: (row: UserRow) => void;
  canEditUsers: boolean;
  canEditRoles: boolean;
  canToggleUserStatus: boolean;
  setPage: Dispatch<SetStateAction<number>>;
}) {
  return (
    <>
      <div className="page-title-row">
        <Input
          aria-label="Search users"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {departments.length > 0 && (
          <Select
            value={departmentFilter || '__all__'}
            onValueChange={(v) => setDepartmentFilter(v === '__all__' ? '' : v)}
          >
            <SelectTrigger aria-label="Filter by department" className="w-[180px]">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All departments</SelectItem>
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
              <h2>No users match</h2>
              <p className="muted">Try a different search term or department.</p>
            </>
          ) : (
            <>
              <h2>No users yet</h2>
              <p className="muted">Create the first account above to start granting access.</p>
            </>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Job title</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
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
                      aria-label="Display name"
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
                      aria-label="Email"
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
                      <SelectTrigger aria-label="Department" size="sm" className="w-[160px]">
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
                      <SelectTrigger aria-label="Job title" size="sm" className="w-[160px]">
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
                <TableCell>{row.isActive ? 'Active' : 'Deactivated'}</TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Checkbox
                      aria-label="KPI applicable"
                      checked={infoDraft.isKpiApplicable}
                      onCheckedChange={(v) => setInfoDraft((d) => ({ ...d, isKpiApplicable: v === true }))}
                    />
                  ) : row.isKpiApplicable ? (
                    'Yes'
                  ) : (
                    'No'
                  )}
                </TableCell>
                {(canToggleUserStatus || canEditUsers || canEditRoles) && (
                  <TableCell>
                    <span className="row-actions" style={{ justifyContent: 'center' }}>
                      {canEditUsers && editingInfoId === row.id && (
                        <>
                          <Button size="sm" disabled={savingInfo} onClick={() => onSaveInfo(row)}>
                            Save info
                          </Button>
                          <Button variant="ghost" size="sm" disabled={savingInfo} onClick={onCancelEditInfo}>
                            Cancel
                          </Button>
                        </>
                      )}
                      {canEditRoles && editingUserId === row.id && (
                        <>
                          <Button size="sm" disabled={savingRoles} onClick={() => onSaveRoles(row)}>
                            Save roles
                          </Button>
                          <Button variant="ghost" size="sm" disabled={savingRoles} onClick={onCancelEditRoles}>
                            Cancel
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="field-kebab-summary"
                            aria-label="More actions"
                            title="More actions"
                          >
                            <MoreVertical size={16} aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditUsers && editingInfoId !== row.id && (
                            <DropdownMenuItem onSelect={() => onStartEditInfo(row)}>Edit</DropdownMenuItem>
                          )}
                          {canEditUsers && (
                            <DropdownMenuItem onSelect={() => onStartResetPassword(row)}>
                              Reset password
                            </DropdownMenuItem>
                          )}
                          {canToggleUserStatus && (
                            <DropdownMenuItem onSelect={() => onToggleStatus(row)}>
                              {row.isActive ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                          )}
                          {canEditRoles && editingUserId !== row.id && (
                            <DropdownMenuItem onSelect={() => onStartEditRoles(row)}>Change role</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pagination && pagination.totalItems > 0 && (
        <div className="page-title-row" aria-label="Users pagination">
          <span className="muted">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}
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
              Previous
            </Button>
            <span className="muted">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            >
              Next
            </Button>
          </span>
        </div>
      )}
    </>
  );
}

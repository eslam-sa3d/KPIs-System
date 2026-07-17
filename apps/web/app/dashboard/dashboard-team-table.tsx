'use client';

import type { TeamMember } from '@pulse/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STATUS_LABEL, STATUS_ORDER, StatusKey, statusBadgeStyle, statusOf } from '../../lib/kpi-status';

type MemberSortKey = 'name' | 'department' | 'updated';
type CoverageFilter = 'all' | 'scored' | 'pending';

/** The team roster table: coverage/status filter pills, a free-text search,
 *  sortable columns, and a row per member that opens their detail drawer. */
export function DashboardTeamTable({
  show,
  memberCoverageFilter,
  setMemberCoverageFilter,
  memberStatusFilter,
  setMemberStatusFilter,
  memberSort,
  sortMembersBy,
  memberFilter,
  setMemberFilter,
  memberTableData,
  totalTeamMemberCount,
  filteredTeamMemberCount,
  onSelectMember,
  onClearFilters,
}: {
  show: boolean;
  memberCoverageFilter: CoverageFilter;
  setMemberCoverageFilter: (filter: CoverageFilter) => void;
  memberStatusFilter: StatusKey | 'all';
  setMemberStatusFilter: (filter: StatusKey | 'all') => void;
  memberSort: { key: MemberSortKey; dir: 1 | -1 };
  sortMembersBy: (key: MemberSortKey) => void;
  memberFilter: string;
  setMemberFilter: (value: string) => void;
  memberTableData: TeamMember[];
  totalTeamMemberCount: number;
  filteredTeamMemberCount: number;
  onSelectMember: (id: string) => void;
  onClearFilters: () => void;
}) {
  if (!show) return null;
  return (
    <div className="p-table-card">
      <div className="p-table-header">
        <div className="p-filter-pills">
          {(['all', 'scored', 'pending'] as const).map((s) => (
            <Badge
              key={s}
              asChild
              variant={memberCoverageFilter === s ? 'default' : 'outline'}
              className="cursor-pointer py-1"
            >
              <button onClick={() => setMemberCoverageFilter(s)}>{s === 'all' ? 'All' : s}</button>
            </Badge>
          ))}
        </div>
        <div className="p-filter-pills">
          {(['all', ...STATUS_ORDER] as const).map((s) => (
            <Badge
              key={s}
              asChild
              variant={memberStatusFilter === s ? 'default' : 'outline'}
              className="cursor-pointer py-1"
            >
              <button onClick={() => setMemberStatusFilter(s)}>{s === 'all' ? 'All' : STATUS_LABEL[s]}</button>
            </Badge>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          Sort: {memberSort.key} {memberSort.dir > 0 ? '↑' : '↓'}
        </span>
      </div>
      <div className="page-title-row" style={{ marginBottom: 8 }}>
        <Input
          aria-label="Filter team members"
          placeholder="Filter by name, email, department, or role…"
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="p-th-sortable"
              aria-sort={memberSort.key === 'name' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" onClick={() => sortMembersBy('name')}>
                Name
              </button>
            </TableHead>
            <TableHead
              className="p-th-sortable"
              aria-sort={memberSort.key === 'department' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" onClick={() => sortMembersBy('department')}>
                Department
              </button>
            </TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Score</TableHead>
            <TableHead
              className="p-th-sortable"
              aria-sort={memberSort.key === 'updated' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" onClick={() => sortMembersBy('updated')}>
                Last updated
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberTableData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                {totalTeamMemberCount === 0 ? 'No active team members.' : 'No team members match this filter.'}
              </TableCell>
            </TableRow>
          ) : (
            memberTableData.map((m) => {
              const memberStatus = statusOf(m.score);
              return (
                <TableRow
                  key={m.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${m.displayName}'s rate`}
                  onClick={() => onSelectMember(m.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectMember(m.id);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <TableCell style={{ fontWeight: 500 }}>{m.displayName}</TableCell>
                  <TableCell className="muted">{m.department ?? '—'}</TableCell>
                  <TableCell className="muted">{m.roles.join(', ') || '—'}</TableCell>
                  <TableCell>
                    <Badge className="border-transparent" style={statusBadgeStyle(memberStatus)}>
                      {STATUS_LABEL[memberStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="muted" style={{ fontFamily: 'var(--mono)' }}>
                    {m.score !== null ? `${m.score.toFixed(1)} / 5` : '—'}
                  </TableCell>
                  <TableCell className="muted" style={{ fontFamily: 'var(--mono)' }}>
                    {m.lastUpdated ? new Date(m.lastUpdated).toLocaleDateString() : '—'}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      <div className="p-table-footer">
        <span className="p-tf-count">
          Showing {memberTableData.length} of {filteredTeamMemberCount} team members
        </span>
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}

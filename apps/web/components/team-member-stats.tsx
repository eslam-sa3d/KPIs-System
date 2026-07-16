import { Building2, UserCheck, UserX, Users as UsersIcon } from 'lucide-react';
import type { UserStats } from './team-members-manager';

/** Headline insight cards for the team members list — total/active/inactive
 *  counts plus department coverage, reloaded independently of the current
 *  (possibly filtered/paginated) page. */
export function TeamMemberStats({ stats }: { stats: UserStats | null }) {
  if (!stats) return null;
  return (
    <div className="insights-row">
      <div className="insight-card tone-purple">
        <span className="hierarchy-icon hierarchy-icon-sm">
          <UsersIcon size={15} aria-hidden="true" />
        </span>
        <span className="insight-card-body">
          <strong>{stats.total}</strong>
          <span>{stats.total === 1 ? 'User' : 'Users'}</span>
        </span>
      </div>
      <div className="insight-card tone-blue">
        <span className="hierarchy-icon hierarchy-icon-sm">
          <Building2 size={15} aria-hidden="true" />
        </span>
        <span className="insight-card-body">
          <strong>{stats.departments}</strong>
          <span>
            {stats.departments === 1 ? 'Department' : 'Departments'} · {stats.assignedToDepartment} assigned
          </span>
        </span>
      </div>
      <div className="insight-card tone-green">
        <span className="hierarchy-icon hierarchy-icon-sm">
          <UserCheck size={15} aria-hidden="true" />
        </span>
        <span className="insight-card-body">
          <strong>{stats.active}</strong>
          <span>Activated</span>
        </span>
      </div>
      <div className="insight-card tone-amber">
        <span className="hierarchy-icon hierarchy-icon-sm">
          <UserX size={15} aria-hidden="true" />
        </span>
        <span className="insight-card-body">
          <strong>{stats.inactive}</strong>
          <span>Deactivated</span>
        </span>
      </div>
    </div>
  );
}

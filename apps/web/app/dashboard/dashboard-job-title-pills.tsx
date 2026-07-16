'use client';

import type { TeamMember } from '@pulse/contracts';
import { Badge } from '@/components/ui/badge';

/** Distinct job titles actually present among the team, for the filter
 *  pills — "all job titles" plus one pill per title in use, each showing
 *  how many members carry it (mirrors the cadence pills' own pattern above). */
export function DashboardJobTitlePills({
  show,
  jobTitleOptions,
  jobTitleFilter,
  setJobTitleFilter,
  teamMembers,
}: {
  show: boolean;
  jobTitleOptions: string[];
  jobTitleFilter: string;
  setJobTitleFilter: (title: string) => void;
  teamMembers: TeamMember[];
}) {
  if (!show || jobTitleOptions.length === 0) return null;
  return (
    <div className="p-filter-pills" style={{ marginBottom: 20 }}>
      <Badge asChild variant={jobTitleFilter === 'all' ? 'default' : 'outline'} className="cursor-pointer py-1">
        <button onClick={() => setJobTitleFilter('all')}>All job titles ({teamMembers.length})</button>
      </Badge>
      {jobTitleOptions.map((title) => (
        <Badge
          key={title}
          asChild
          variant={jobTitleFilter === title ? 'default' : 'outline'}
          className="cursor-pointer py-1"
        >
          <button onClick={() => setJobTitleFilter(title)}>
            {title} ({teamMembers.filter((m) => m.jobTitle === title).length})
          </button>
        </Badge>
      ))}
    </div>
  );
}

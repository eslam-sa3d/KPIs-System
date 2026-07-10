'use client';

import { PortalShell } from '../../../components/portal-shell';
import { TeamMembersManager } from '../../../components/team-members-manager';
import { useSession } from '../../../lib/use-session';

export default function UsersAdminPage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>users</h1>
      <p className="portal-subtitle">create accounts, assign roles, and manage access tiers</p>
      <TeamMembersManager user={user} />
    </PortalShell>
  );
}

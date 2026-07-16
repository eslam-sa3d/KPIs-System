'use client';

import { PortalShell } from '../../../components/portal-shell';
import { DepartmentsManager, ProjectGroupsManager } from '../../../components/departments-manager';
import { TeamMembersManager } from '../../../components/team-members-manager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '../../../lib/use-session';

export default function SettingsPage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>Settings</h1>
      <p className="portal-subtitle">Platform administration</p>

      <Tabs defaultValue="departments">
        <TabsList>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="project-groups">Project groups</TabsTrigger>
          <TabsTrigger value="team">Team members</TabsTrigger>
        </TabsList>
        <TabsContent value="departments">
          <DepartmentsManager user={user} />
        </TabsContent>
        <TabsContent value="project-groups">
          <ProjectGroupsManager user={user} />
        </TabsContent>
        <TabsContent value="team">
          <TeamMembersManager user={user} />
        </TabsContent>
      </Tabs>
    </PortalShell>
  );
}

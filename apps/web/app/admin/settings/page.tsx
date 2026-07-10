'use client';

import { PortalShell } from '../../../components/portal-shell';
import { DepartmentsManager } from '../../../components/departments-manager';
import { TeamMembersManager } from '../../../components/team-members-manager';
import { ChangePasswordForm } from '../../../components/change-password-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '../../../lib/use-session';

export default function SettingsPage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>settings</h1>
      <p className="portal-subtitle">platform administration</p>

      <Tabs defaultValue="departments">
        <TabsList>
          <TabsTrigger value="departments">departments</TabsTrigger>
          <TabsTrigger value="team">team members</TabsTrigger>
          <TabsTrigger value="account">account</TabsTrigger>
        </TabsList>
        <TabsContent value="departments">
          <DepartmentsManager user={user} />
        </TabsContent>
        <TabsContent value="team">
          <TeamMembersManager user={user} />
        </TabsContent>
        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>change password</CardTitle>
              <CardDescription>
                changing your password signs you out of every other device — you&apos;ll need to sign in again
                here too.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PortalShell>
  );
}

'use client';

import { PortalShell } from '../../components/portal-shell';
import { ChangePasswordForm } from '../../components/change-password-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '../../lib/use-session';

export default function ChangePasswordPage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>change your password</h1>

      <Alert>
        <AlertDescription>
          you&apos;re signing in with a temporary password — set a new one to continue.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>change password</CardTitle>
          <CardDescription>enter the temporary password you signed in with as your current password.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </PortalShell>
  );
}

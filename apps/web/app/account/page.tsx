'use client';

import { PortalShell } from '../../components/portal-shell';
import { ChangePasswordForm } from '../../components/change-password-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '../../lib/use-session';

export default function AccountPage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>account</h1>
      <p className="portal-subtitle">{user?.email}</p>

      <Card>
        <CardHeader>
          <CardTitle>change password</CardTitle>
          <CardDescription>
            changing your password signs you out of every other device — you&apos;ll need to sign in again here
            too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </PortalShell>
  );
}

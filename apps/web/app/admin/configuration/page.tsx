'use client';

import { PortalShell } from '../../../components/portal-shell';
import { JobTitlesManager } from '../../../components/job-titles-manager';
import { PerformanceLevelsManager } from '../../../components/performance-levels-manager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '../../../lib/use-session';

export default function ConfigurationPage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>configuration</h1>
      <p className="portal-subtitle">scoring configuration</p>

      <Tabs defaultValue="performance-levels">
        <TabsList>
          <TabsTrigger value="performance-levels">performance levels</TabsTrigger>
          <TabsTrigger value="job-titles">job titles</TabsTrigger>
        </TabsList>
        <TabsContent value="performance-levels">
          <PerformanceLevelsManager user={user} />
        </TabsContent>
        <TabsContent value="job-titles">
          <JobTitlesManager user={user} />
        </TabsContent>
      </Tabs>
    </PortalShell>
  );
}

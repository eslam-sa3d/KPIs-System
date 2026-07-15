import { z } from 'zod';

/** Global, admin-managed subset of Forms whose submissions feed the
 *  dashboard — see apps/api's DashboardFormScope model. `formIds` empty
 *  means unrestricted (every form counts). */

export const dashboardFormScopeSchema = z.object({
  formIds: z.array(z.string().uuid()),
});

export type DashboardFormScopeInput = z.infer<typeof dashboardFormScopeSchema>;

export interface DashboardFormScope {
  formIds: string[];
}

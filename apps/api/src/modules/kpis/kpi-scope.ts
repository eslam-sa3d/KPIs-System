import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

/** Shared between KpisService (CRUD) and KpiDashboardService (aggregation
 *  reads) — both need "which KPIs does this caller's role/department cover"
 *  and "what form ids is the dashboard currently allowed to read". Kept as
 *  plain functions (not methods on either service) so neither service has to
 *  depend on the other just for this. */

/** { assignments: { some: { OR: [...] } } } scoped to a user's own roles/department. */
export async function myAssignmentFilter(prisma: PrismaService, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, roles: { select: { roleId: true } } },
  });
  if (!user) throw AppError.notFound('User', userId);

  const roleIds = user.roles.map((r) => r.roleId);
  const scope: object[] = [{ roleId: { in: roleIds } }];
  if (user.departmentId) scope.push({ departmentId: user.departmentId });
  return { assignments: { some: { OR: scope } } };
}

/** Whether this caller holds kpis:manage in any role — gates seeing the
 *  evaluator identity on entries their originating mapping marked anonymous. */
export async function canSeeAnonymousEvaluators(prisma: PrismaService, userId: string): Promise<boolean> {
  const grant = await prisma.rolePermission.findFirst({
    where: {
      role: { isActive: true, users: { some: { userId } } },
      permission: { resource: 'kpis', action: 'manage' },
    },
    select: { roleId: true },
  });
  return grant !== null;
}

/** The admin-configured dashboard-form-scope, resolved to `null` (no
 *  restriction) or the explicit list of allowed form ids — every
 *  dashboard-facing query takes this as an optional param rather than
 *  re-fetching it itself, so one request only reads the setting once. */
export async function allowedFormIds(prisma: PrismaService): Promise<string[] | null> {
  const scope = await prisma.dashboardFormScope.findUnique({ where: { id: 1 } });
  return scope && scope.formIds.length > 0 ? scope.formIds : null;
}

/** EvaluationAreaEntry has no formId of its own — only a nullable
 *  submissionId. An entry recorded via the direct (non-forms) API has no
 *  submission to trace back to a form at all, so it always counts,
 *  regardless of the dashboard-form-scope; only entries traceable to an
 *  excluded form are filtered out. Returns undefined (no-op) when
 *  unrestricted. */
export function legacyEntryFormFilter(
  allowedFormIdList: string[] | null,
): Prisma.EvaluationAreaEntryWhereInput | undefined {
  if (allowedFormIdList === null) return undefined;
  return { OR: [{ submissionId: null }, { submission: { formVersion: { formId: { in: allowedFormIdList } } } }] };
}

/** Prisma.Decimal's own toJSON() serializes to a string, so every KPI
 *  leaving these services must go through here — otherwise `weight` reaches
 *  the client as e.g. "20.00" and silently turns `sum + weight` client-side
 *  into string concatenation instead of addition. */
export function serializeKpi<T extends { weight: Prisma.Decimal | number | null }>(
  kpi: T,
): Omit<T, 'weight'> & { weight: number | null } {
  return { ...kpi, weight: kpi.weight === null ? null : Number(kpi.weight) };
}

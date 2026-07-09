import { SetMetadata } from '@nestjs/common';

export type FormPermissionAction = 'view' | 'manage';

export const FORM_PERMISSION_KEY = 'form_permission_action';

/**
 * Declares that a form-scoped response route needs at least the "view" or
 * "manage" tier — granted by global RBAC (form_submissions:read/manage), form
 * ownership, or a per-form collaborator's own tier (see FormCollaborator).
 * Read by FormAccessGuard, which is the only place this decision is made —
 * unlike @RequirePermissions (AND-combined with every other guard in the
 * chain), a form-scoped route can be reached by several DIFFERENT grants,
 * which only a single guard evaluating all of them together can express.
 *
 *   @FormPermission('view')
 *   @Get(':slug/submissions') list(...) {}
 */
export const FormPermission = (action: FormPermissionAction) => SetMetadata(FORM_PERMISSION_KEY, action);

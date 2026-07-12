import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '@pulse/contracts';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Declares the permissions a route needs. The caller must hold ALL of them.
 *
 *   @RequirePermissions('forms:write')
 *   @Post() createForm(...) {}
 */
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

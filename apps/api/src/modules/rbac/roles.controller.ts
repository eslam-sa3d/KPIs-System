import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ACTIONS, CreateRoleInput, RESOURCES, createRoleSchema } from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from './require-permissions.decorator';
import { RbacService } from './rbac.service';

@Controller('v1/roles')
export class RolesController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  @RequirePermissions('roles:read')
  list() {
    return this.rbac.listRoles();
  }

  /** The composable permission catalog the role editor renders. */
  @Get('permission-catalog')
  @RequirePermissions('roles:read')
  catalog() {
    return { resources: RESOURCES, actions: ACTIONS };
  }

  @Post()
  @RequirePermissions('roles:manage')
  createRole(
    @Body(new ZodValidationPipe(createRoleSchema)) input: CreateRoleInput,
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.createRole(input, req.user.id);
  }

  @Put(':roleId/permissions')
  @RequirePermissions('roles:manage')
  updatePermissions(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(createRoleSchema.shape.permissions))
    permissions: CreateRoleInput['permissions'],
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.updateRolePermissions(roleId, permissions, req.user.id);
  }

  @Post(':roleId/users/:userId')
  @RequirePermissions('roles:manage', 'users:write')
  assignRole(
    @Param('roleId') roleId: string,
    @Param('userId') userId: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.assignRoleToUser(userId, roleId, req.user.id);
  }
}

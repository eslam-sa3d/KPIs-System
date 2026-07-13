import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  ACTIONS,
  CreateRoleInput,
  RESOURCES,
  SCOPES,
  SetRoleStatusInput,
  UpdateRoleInput,
  createRoleSchema,
  setRoleStatusSchema,
  updateRoleSchema,
} from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from './require-permissions.decorator';
import { RbacService } from './rbac.service';

@Controller('v1/roles')
export class RolesController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  @RequirePermissions('roles:view')
  list() {
    return this.rbac.listRoles();
  }

  /** The composable permission catalog the role editor renders. */
  @Get('permission-catalog')
  @RequirePermissions('roles:view')
  catalog() {
    return { resources: RESOURCES, actions: ACTIONS, scopes: SCOPES };
  }

  @Post()
  @RequirePermissions('roles:edit')
  createRole(
    @Body(new ZodValidationPipe(createRoleSchema)) input: CreateRoleInput,
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.createRole(input, req.user.id);
  }

  @Patch(':roleId')
  @RequirePermissions('roles:edit')
  updateRole(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) input: UpdateRoleInput,
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.updateRole(roleId, input, req.user.id);
  }

  @Patch(':roleId/status')
  @RequirePermissions('roles:activate_deactivate')
  setStatus(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(setRoleStatusSchema)) input: SetRoleStatusInput,
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.setRoleStatus(roleId, input, req.user.id);
  }

  @Delete(':roleId')
  @RequirePermissions('roles:delete')
  deleteRole(@Param('roleId') roleId: string, @Req() req: { user: { id: string } }) {
    return this.rbac.deleteRole(roleId, req.user.id);
  }

  @Put(':roleId/permissions')
  @RequirePermissions('roles:edit')
  updatePermissions(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(createRoleSchema.shape.permissions))
    permissions: CreateRoleInput['permissions'],
    @Req() req: { user: { id: string } },
  ) {
    return this.rbac.updateRolePermissions(roleId, permissions, req.user.id);
  }

  @Post(':roleId/users/:userId')
  @RequirePermissions('roles:edit', 'users:edit')
  assignRole(@Param('roleId') roleId: string, @Param('userId') userId: string, @Req() req: { user: { id: string } }) {
    return this.rbac.assignRoleToUser(userId, roleId, req.user.id);
  }

  @Delete(':roleId/users/:userId')
  @RequirePermissions('roles:edit', 'users:edit')
  unassignRole(@Param('roleId') roleId: string, @Param('userId') userId: string, @Req() req: { user: { id: string } }) {
    return this.rbac.unassignRoleFromUser(userId, roleId, req.user.id);
  }
}

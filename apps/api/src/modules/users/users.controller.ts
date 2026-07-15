import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  AddProjectGroupMembersInput,
  AdminResetPasswordInput,
  CreateDepartmentInput,
  CreateProjectGroupInput,
  CreateUserInput,
  PageQuery,
  SetUserStatusInput,
  UpdateDepartmentInput,
  UpdateProjectGroupInput,
  UpdateUserInput,
  addProjectGroupMembersSchema,
  adminResetPasswordSchema,
  createDepartmentSchema,
  createProjectGroupSchema,
  createUserSchema,
  setUserStatusSchema,
  updateDepartmentSchema,
  updateProjectGroupSchema,
  updateUserSchema,
} from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { UsersService } from './users.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:view')
  list(@Query() query: PageQuery & { search?: string; departmentId?: string }, @Req() req: AuthedRequest) {
    return this.users.list(query, req.user.id);
  }

  /** Headline counts for the users page's stat widgets — computed by aggregate
   *  query rather than derived from a (possibly filtered/paginated) list page. */
  @Get('stats')
  @RequirePermissions('users:view')
  stats(@Req() req: AuthedRequest) {
    return this.users.stats(req.user.id);
  }

  @Post()
  @RequirePermissions('users:edit')
  create(@Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput, @Req() req: AuthedRequest) {
    return this.users.create(input, req.user.id);
  }

  @Patch(':userId')
  @RequirePermissions('users:edit')
  update(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateUserSchema)) input: UpdateUserInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.update(userId, input, req.user.id);
  }

  @Patch(':userId/status')
  @RequirePermissions('users:activate_deactivate')
  setStatus(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setUserStatusSchema)) input: SetUserStatusInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.setStatus(userId, input.isActive, req.user.id);
  }

  @Patch(':userId/password')
  @RequirePermissions('users:edit')
  resetPassword(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(adminResetPasswordSchema)) input: AdminResetPasswordInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.resetPassword(userId, input.newPassword, req.user.id);
  }
}

@Controller('v1/departments')
export class DepartmentsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('departments:view')
  list() {
    return this.users.listDepartments();
  }

  @Post()
  @RequirePermissions('departments:edit')
  create(@Body(new ZodValidationPipe(createDepartmentSchema)) input: CreateDepartmentInput, @Req() req: AuthedRequest) {
    return this.users.createDepartment(input, req.user.id);
  }

  @Patch(':departmentId')
  @RequirePermissions('departments:edit')
  rename(
    @Param('departmentId') departmentId: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) input: UpdateDepartmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.renameDepartment(departmentId, input, req.user.id);
  }

  @Delete(':departmentId')
  @RequirePermissions('departments:delete')
  remove(@Param('departmentId') departmentId: string, @Req() req: AuthedRequest) {
    return this.users.deleteDepartment(departmentId, req.user.id);
  }
}

@Controller('v1/project-groups')
export class ProjectGroupsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('project_groups:view')
  list() {
    return this.users.listProjectGroups();
  }

  @Post()
  @RequirePermissions('project_groups:edit')
  create(
    @Body(new ZodValidationPipe(createProjectGroupSchema)) input: CreateProjectGroupInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.createProjectGroup(input, req.user.id);
  }

  @Patch(':groupId')
  @RequirePermissions('project_groups:edit')
  rename(
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(updateProjectGroupSchema)) input: UpdateProjectGroupInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.renameProjectGroup(groupId, input, req.user.id);
  }

  @Delete(':groupId')
  @RequirePermissions('project_groups:delete')
  remove(@Param('groupId') groupId: string, @Req() req: AuthedRequest) {
    return this.users.deleteProjectGroup(groupId, req.user.id);
  }

  @Get(':groupId/members')
  @RequirePermissions('project_groups:view')
  listMembers(@Param('groupId') groupId: string) {
    return this.users.listProjectGroupMembers(groupId);
  }

  @Post(':groupId/members')
  @RequirePermissions('project_groups:edit')
  addMembers(
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(addProjectGroupMembersSchema)) input: AddProjectGroupMembersInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.addProjectGroupMembers(groupId, input.userIds, req.user.id);
  }

  @Delete(':groupId/members/:userId')
  @RequirePermissions('project_groups:edit')
  removeMember(@Param('groupId') groupId: string, @Param('userId') userId: string, @Req() req: AuthedRequest) {
    return this.users.removeProjectGroupMember(groupId, userId, req.user.id);
  }
}

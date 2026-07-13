import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  CreateDepartmentInput,
  CreateUserInput,
  PageQuery,
  SetUserStatusInput,
  UpdateDepartmentInput,
  UpdateUserInput,
  createDepartmentSchema,
  createUserSchema,
  setUserStatusSchema,
  updateDepartmentSchema,
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
  @RequirePermissions('users:read')
  list(@Query() query: PageQuery & { search?: string; departmentId?: string }, @Req() req: AuthedRequest) {
    return this.users.list(query, req.user.id);
  }

  /** Headline counts for the users page's stat widgets — computed by aggregate
   *  query rather than derived from a (possibly filtered/paginated) list page. */
  @Get('stats')
  @RequirePermissions('users:read')
  stats(@Req() req: AuthedRequest) {
    return this.users.stats(req.user.id);
  }

  @Post()
  @RequirePermissions('users:write')
  create(@Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput, @Req() req: AuthedRequest) {
    return this.users.create(input, req.user.id);
  }

  @Patch(':userId')
  @RequirePermissions('users:write')
  update(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateUserSchema)) input: UpdateUserInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.update(userId, input, req.user.id);
  }

  @Patch(':userId/status')
  @RequirePermissions('users:manage')
  setStatus(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setUserStatusSchema)) input: SetUserStatusInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.setStatus(userId, input.isActive, req.user.id);
  }
}

@Controller('v1/departments')
export class DepartmentsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('departments:read')
  list() {
    return this.users.listDepartments();
  }

  @Post()
  @RequirePermissions('departments:manage')
  create(@Body(new ZodValidationPipe(createDepartmentSchema)) input: CreateDepartmentInput, @Req() req: AuthedRequest) {
    return this.users.createDepartment(input, req.user.id);
  }

  @Patch(':departmentId')
  @RequirePermissions('departments:manage')
  rename(
    @Param('departmentId') departmentId: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) input: UpdateDepartmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.renameDepartment(departmentId, input, req.user.id);
  }

  @Delete(':departmentId')
  @RequirePermissions('departments:manage')
  remove(@Param('departmentId') departmentId: string, @Req() req: AuthedRequest) {
    return this.users.deleteDepartment(departmentId, req.user.id);
  }
}

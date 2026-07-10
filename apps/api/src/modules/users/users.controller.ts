import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  CreateDepartmentInput,
  CreateUserInput,
  PageQuery,
  SetUserStatusInput,
  UpdateDepartmentInput,
  createDepartmentSchema,
  createUserSchema,
  setUserStatusSchema,
  updateDepartmentSchema,
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
  list(@Query() query: PageQuery, @Query('isActive') isActive?: string) {
    return this.users.list(query, isActive === undefined ? undefined : isActive === 'true');
  }

  @Post()
  @RequirePermissions('users:write')
  create(
    @Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.create(input, req.user.id);
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
  create(
    @Body(new ZodValidationPipe(createDepartmentSchema)) input: CreateDepartmentInput,
    @Req() req: AuthedRequest,
  ) {
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

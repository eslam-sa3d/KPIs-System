import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  CreatePerformanceLevelInput,
  UpdatePerformanceLevelInput,
  createPerformanceLevelSchema,
  updatePerformanceLevelSchema,
} from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PerformanceLevelsService } from './performance-levels.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/performance-levels')
export class PerformanceLevelsController {
  constructor(private readonly levels: PerformanceLevelsService) {}

  @Get()
  @RequirePermissions('configuration:view')
  list() {
    return this.levels.list();
  }

  @Post()
  @RequirePermissions('configuration:edit')
  create(
    @Body(new ZodValidationPipe(createPerformanceLevelSchema)) input: CreatePerformanceLevelInput,
    @Req() req: AuthedRequest,
  ) {
    return this.levels.create(input, req.user.id);
  }

  @Patch(':levelId')
  @RequirePermissions('configuration:edit')
  update(
    @Param('levelId') levelId: string,
    @Body(new ZodValidationPipe(updatePerformanceLevelSchema)) input: UpdatePerformanceLevelInput,
    @Req() req: AuthedRequest,
  ) {
    return this.levels.update(levelId, input, req.user.id);
  }

  @Delete(':levelId')
  @RequirePermissions('configuration:delete')
  remove(@Param('levelId') levelId: string, @Req() req: AuthedRequest) {
    return this.levels.remove(levelId, req.user.id);
  }
}

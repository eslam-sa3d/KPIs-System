import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  CreatePerformanceLevelInput,
  UpdatePerformanceLevelInput,
  createPerformanceLevelSchema,
  updatePerformanceLevelSchema,
} from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PerformanceLevelsService } from './performance-levels.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/performance-levels')
export class PerformanceLevelsController {
  constructor(private readonly levels: PerformanceLevelsService) {}

  // Public: FormRenderer fetches this for every 'performance_level' field,
  // including on the anonymous public /f fill flow — an authenticated-only
  // route there just meant every anonymous respondent silently got "no
  // performance levels configured yet" instead of real options (401 →
  // FormRenderer's catch → []). Labels/score ranges aren't sensitive, same
  // reasoning as BrandingController's public GET.
  @Public()
  @Get()
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

import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  CreateScoreLabelInput,
  UpdateScoreLabelInput,
  createScoreLabelSchema,
  updateScoreLabelSchema,
} from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { ScoreLabelsService } from './score-labels.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/score-labels')
export class ScoreLabelsController {
  constructor(private readonly labels: ScoreLabelsService) {}

  // Public: same reasoning as PerformanceLevelsController's public GET —
  // labels/scores aren't sensitive, and any future form field reading these
  // needs them on the anonymous public /f fill flow too.
  @Public()
  @Get()
  list() {
    return this.labels.list();
  }

  @Post()
  @RequirePermissions('configuration:edit')
  create(
    @Body(new ZodValidationPipe(createScoreLabelSchema)) input: CreateScoreLabelInput,
    @Req() req: AuthedRequest,
  ) {
    return this.labels.create(input, req.user.id);
  }

  @Patch(':labelId')
  @RequirePermissions('configuration:edit')
  update(
    @Param('labelId') labelId: string,
    @Body(new ZodValidationPipe(updateScoreLabelSchema)) input: UpdateScoreLabelInput,
    @Req() req: AuthedRequest,
  ) {
    return this.labels.update(labelId, input, req.user.id);
  }

  @Delete(':labelId')
  @RequirePermissions('configuration:delete')
  remove(@Param('labelId') labelId: string, @Req() req: AuthedRequest) {
    return this.labels.remove(labelId, req.user.id);
  }
}

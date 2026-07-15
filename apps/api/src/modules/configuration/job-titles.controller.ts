import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CreateJobTitleInput, UpdateJobTitleInput, createJobTitleSchema, updateJobTitleSchema } from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { JobTitlesService } from './job-titles.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/job-titles')
export class JobTitlesController {
  constructor(private readonly jobTitles: JobTitlesService) {}

  @Get()
  @RequirePermissions('configuration:view')
  list() {
    return this.jobTitles.list();
  }

  @Post()
  @RequirePermissions('configuration:edit')
  create(@Body(new ZodValidationPipe(createJobTitleSchema)) input: CreateJobTitleInput, @Req() req: AuthedRequest) {
    return this.jobTitles.create(input, req.user.id);
  }

  @Patch(':jobTitleId')
  @RequirePermissions('configuration:edit')
  update(
    @Param('jobTitleId') jobTitleId: string,
    @Body(new ZodValidationPipe(updateJobTitleSchema)) input: UpdateJobTitleInput,
    @Req() req: AuthedRequest,
  ) {
    return this.jobTitles.update(jobTitleId, input, req.user.id);
  }

  @Delete(':jobTitleId')
  @RequirePermissions('configuration:delete')
  remove(@Param('jobTitleId') jobTitleId: string, @Req() req: AuthedRequest) {
    return this.jobTitles.remove(jobTitleId, req.user.id);
  }
}

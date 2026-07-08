import { Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { PageQuery, SubmissionAnswers, submissionAnswersSchema } from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { FormsService } from './forms.service';
import { SubmissionsService } from './submissions.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/forms')
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Post()
  @RequirePermissions('forms:write')
  createForm(
    @Body() body: { slug: string; definition: unknown },
    @Req() req: AuthedRequest,
  ) {
    return this.forms.createForm(body.slug, body.definition, req.user.id);
  }

  @Post(':formId/versions')
  @RequirePermissions('forms:write')
  publishNewVersion(@Param('formId') formId: string, @Body() body: { definition: unknown }) {
    return this.forms.publishNewVersion(formId, body.definition);
  }

  @Get(':slug')
  @RequirePermissions('forms:read')
  getForm(@Param('slug') slug: string) {
    return this.forms.getLatestVersion(slug);
  }

  @Post(':slug/submissions')
  @RequirePermissions('form_submissions:write')
  submit(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(submissionAnswersSchema)) answers: SubmissionAnswers,
    @Req() req: AuthedRequest,
  ) {
    return this.submissions.submit(slug, answers, req.user.id);
  }

  @Get(':slug/submissions')
  @RequirePermissions('form_submissions:read')
  list(
    @Param('slug') slug: string,
    @Query() query: PageQuery & { [filter: `answers.${string}`]: string },
  ) {
    const filters = Object.fromEntries(
      Object.entries(query)
        .filter(([key]) => key.startsWith('answers.'))
        .map(([key, value]) => [key.slice('answers.'.length), String(value)]),
    );
    return this.submissions.list(slug, query, filters);
  }

  @Get(':slug/submissions/export')
  @RequirePermissions('form_submissions:read', 'form_submissions:execute')
  @Header('Content-Type', 'text/csv')
  export(@Param('slug') slug: string, @Req() req: AuthedRequest) {
    return this.submissions.exportCsv(slug, req.user.id);
  }
}

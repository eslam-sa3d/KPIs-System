import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PageQuery, SubmissionAnswers, submissionAnswersSchema } from '@pulse/contracts';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
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

  @Get()
  @RequirePermissions('forms:read')
  listForms() {
    return this.forms.listForms();
  }

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

  @Patch(':formId/settings')
  @RequirePermissions('forms:write')
  updateSettings(
    @Param('formId') formId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return this.forms.updateSettings(formId, body, req.user.id);
  }

  @Post(':formId/share-link')
  @RequirePermissions('forms:manage')
  setShareLink(
    @Param('formId') formId: string,
    @Body() body: { enabled: boolean },
    @Req() req: AuthedRequest,
  ) {
    return this.forms.setShareLink(formId, Boolean(body?.enabled), req.user.id);
  }

  @Post(':formId/duplicate')
  @RequirePermissions('forms:write')
  duplicate(@Param('formId') formId: string, @Req() req: AuthedRequest) {
    return this.forms.duplicate(formId, req.user.id);
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

  @Get(':slug/submissions/summary')
  @RequirePermissions('form_submissions:read')
  summary(@Param('slug') slug: string) {
    return this.submissions.summary(slug);
  }

  @Delete(':slug/submissions/:submissionId')
  @RequirePermissions('form_submissions:manage')
  deleteSubmission(
    @Param('slug') slug: string,
    @Param('submissionId') submissionId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.submissions.deleteSubmission(slug, submissionId, req.user.id);
  }

  /** File download — sends raw CSV via @Res, deliberately outside the JSON envelope. */
  @Get(':slug/submissions/export')
  @RequirePermissions('form_submissions:read', 'form_submissions:execute')
  async export(@Param('slug') slug: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const csv = await this.submissions.exportCsv(slug, req.user.id);
    res
      .type('text/csv')
      .setHeader('Content-Disposition', `attachment; filename="${slug}-submissions.csv"`)
      .send(csv);
  }
}

/** Anonymous fill via tokenized share links — no session, tight rate limits. */
@Controller('v1/public/forms')
export class PublicFormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Public()
  @Get(':token')
  async getForm(@Param('token') token: string) {
    const { definition, settings } = await this.forms.getByPublicToken(token);
    // expose only what a respondent needs — no ids, no internals
    return { definition, settings };
  }

  @Public()
  @Post(':token/submissions')
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // spam brake per IP
  submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(submissionAnswersSchema)) answers: SubmissionAnswers,
  ) {
    return this.submissions.submitPublic(token, answers);
  }
}

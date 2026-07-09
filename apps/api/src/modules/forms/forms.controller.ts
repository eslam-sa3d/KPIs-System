import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { PageQuery, SubmissionAnswers, submissionAnswersSchema } from '@pulse/contracts';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { AssetsService } from './assets.service';
import { FileUploadsService } from './file-uploads.service';
import { FormsService } from './forms.service';
import { SubmissionsService } from './submissions.service';

type AuthedRequest = { user: { id: string } };

// files live in the DB, not disk — memoryStorage keeps the buffer in-process;
// the per-question maxSizeMb cap is enforced in FileUploadsService, this is
// just a generous outer ceiling so an oversized body never reaches it
const UPLOAD_INTERCEPTOR = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
// design assets are capped tighter (5MB, enforced again in AssetsService) —
// this is just the outer multer ceiling, same pattern as UPLOAD_INTERCEPTOR
const ASSET_INTERCEPTOR = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** Anonymous respondent fingerprint — a random id in a long-lived, non-sensitive cookie, the only
 *  "identity" a public-link filler has, used to enforce oneResponsePerUser without an account.
 *  Same cross-site cookie reasoning as the auth refresh cookie (see auth.controller.ts). */
const RESPONDENT_COOKIE = 'pulse_pf';
const respondentCookieSameSite = (process.env.REFRESH_COOKIE_SAMESITE ?? 'strict') as 'strict' | 'lax' | 'none';
const respondentCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || respondentCookieSameSite === 'none',
  sameSite: respondentCookieSameSite,
  path: '/api/v1/public/forms',
  maxAge: 365 * 24 * 60 * 60 * 1000,
};

@Controller('v1/forms')
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly submissions: SubmissionsService,
    private readonly uploads: FileUploadsService,
    private readonly assets: AssetsService,
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

  @Delete(':slug/submissions')
  @RequirePermissions('form_submissions:manage')
  deleteAllSubmissions(@Param('slug') slug: string, @Req() req: AuthedRequest) {
    return this.submissions.deleteAllSubmissions(slug, req.user.id);
  }

  /** Uploaded while a form is still a draft (no formId yet) — claimed on publish, see FormsService. */
  @Post('assets')
  @RequirePermissions('forms:write')
  @UseInterceptors(ASSET_INTERCEPTOR)
  uploadAsset(@UploadedFile() file: Express.Multer.File, @Req() req: AuthedRequest) {
    return this.assets.upload(file, req.user.id);
  }

  /** Design assets (option images, question/page media, theme background & logo) — always public, never sensitive. */
  @Public()
  @Get('assets/:assetId')
  async downloadAsset(@Param('assetId') assetId: string, @Res() res: Response) {
    const asset = await this.assets.getForDownload(assetId);
    res.type(asset.mimeType).send(Buffer.from(asset.data));
  }

  @Post(':slug/uploads/:fieldKey')
  @RequirePermissions('form_submissions:write')
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  uploadFile(
    @Param('slug') slug: string,
    @Param('fieldKey') fieldKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthedRequest,
  ) {
    return this.uploads.upload(slug, fieldKey, file, req.user.id);
  }

  /** Streams the raw file — deliberately outside the JSON envelope, like the CSV export. */
  @Get(':slug/uploads/:uploadId')
  @RequirePermissions('form_submissions:read')
  async downloadFile(
    @Param('slug') slug: string,
    @Param('uploadId') uploadId: string,
    @Res() res: Response,
  ) {
    const upload = await this.uploads.getForDownload(slug, uploadId);
    res
      .type(upload.mimeType)
      .setHeader('Content-Disposition', `attachment; filename="${upload.filename.replace(/"/g, '')}"`)
      .send(Buffer.from(upload.data));
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

  @Get(':slug/submissions/export.xlsx')
  @RequirePermissions('form_submissions:read', 'form_submissions:execute')
  async exportXlsx(@Param('slug') slug: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const buffer = await this.submissions.exportXlsx(slug, req.user.id);
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${slug}-submissions.xlsx"`)
      .send(buffer);
  }
}

/** Anonymous fill via tokenized share links — no session, tight rate limits. */
@Controller('v1/public/forms')
export class PublicFormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly submissions: SubmissionsService,
    private readonly uploads: FileUploadsService,
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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fingerprint = req.cookies?.[RESPONDENT_COOKIE] ?? randomBytes(16).toString('base64url');
    res.cookie(RESPONDENT_COOKIE, fingerprint, respondentCookieOptions);
    return this.submissions.submitPublic(token, answers, fingerprint);
  }

  @Public()
  @Post(':token/uploads/:fieldKey')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  uploadFile(
    @Param('token') token: string,
    @Param('fieldKey') fieldKey: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.uploads.uploadPublic(token, fieldKey, file);
  }
}

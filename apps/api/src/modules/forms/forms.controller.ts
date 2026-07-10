import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { FormPermission } from './form-permission.decorator';
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

  @Post(':formId/export-link')
  @RequirePermissions('forms:manage')
  setExportLink(
    @Param('formId') formId: string,
    @Body() body: { enabled: boolean },
    @Req() req: AuthedRequest,
  ) {
    return this.forms.setExportLink(formId, Boolean(body?.enabled), req.user.id);
  }

  /** Restricts portal access to the creator, collaborators, and forms:manage holders.
   *  forms:write is the coarse gate; FormsService.getOwnedForm enforces the real ownership check. */
  @Post(':formId/restricted')
  @RequirePermissions('forms:write')
  setRestricted(
    @Param('formId') formId: string,
    @Body() body: { restricted: boolean },
    @Req() req: AuthedRequest,
  ) {
    return this.forms.setRestricted(formId, Boolean(body?.restricted), req.user.id);
  }

  @Get(':formId/collaborators')
  @RequirePermissions('forms:write')
  listCollaborators(@Param('formId') formId: string) {
    return this.forms.listCollaborators(formId);
  }

  /** Free-text folder tag shown in the forms list filter. */
  @Post(':formId/folder')
  @RequirePermissions('forms:write')
  setFolder(
    @Param('formId') formId: string,
    @Body() body: { folder: string | null },
    @Req() req: AuthedRequest,
  ) {
    return this.forms.setFolder(formId, body?.folder?.trim() || null, req.user.id);
  }

  @Post(':formId/collaborators')
  @RequirePermissions('forms:write')
  inviteCollaborator(
    @Param('formId') formId: string,
    @Body() body: { userId: string; canManage?: boolean; canViewResponses?: boolean },
    @Req() req: AuthedRequest,
  ) {
    return this.forms.inviteCollaborator(
      formId,
      body.userId,
      Boolean(body?.canManage),
      req.user.id,
      Boolean(body?.canViewResponses),
    );
  }

  @Delete(':formId/collaborators/:userId')
  @RequirePermissions('forms:write')
  removeCollaborator(
    @Param('formId') formId: string,
    @Param('userId') userId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.forms.removeCollaborator(formId, userId, req.user.id);
  }

  @Post(':formId/duplicate')
  @RequirePermissions('forms:write')
  duplicate(@Param('formId') formId: string, @Req() req: AuthedRequest) {
    return this.forms.duplicate(formId, req.user.id);
  }

  /** Hides the form from the default list and closes its public/export links
   *  to further use, without touching submission history. */
  @Post(':formId/archive')
  @RequirePermissions('forms:manage')
  archiveForm(@Param('formId') formId: string, @Req() req: AuthedRequest) {
    return this.forms.archiveForm(formId, req.user.id);
  }

  @Post(':formId/unarchive')
  @RequirePermissions('forms:manage')
  unarchiveForm(@Param('formId') formId: string, @Req() req: AuthedRequest) {
    return this.forms.unarchiveForm(formId, req.user.id);
  }

  /** Permanently removes the form. Blocked once it has any submissions —
   *  archive it instead so response history can't be silently destroyed. */
  @Delete(':formId')
  @RequirePermissions('forms:manage')
  deleteForm(@Param('formId') formId: string, @Req() req: AuthedRequest) {
    return this.forms.deleteForm(formId, req.user.id);
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
  @FormPermission('view')
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
  @FormPermission('view')
  summary(@Param('slug') slug: string) {
    return this.submissions.summary(slug);
  }

  @Patch(':slug/submissions/:submissionId')
  @FormPermission('manage')
  updateSubmission(
    @Param('slug') slug: string,
    @Param('submissionId') submissionId: string,
    @Body(new ZodValidationPipe(submissionAnswersSchema)) answers: SubmissionAnswers,
    @Req() req: AuthedRequest,
  ) {
    return this.submissions.updateSubmission(slug, submissionId, answers, req.user.id);
  }

  @Delete(':slug/submissions/:submissionId')
  @FormPermission('manage')
  deleteSubmission(
    @Param('slug') slug: string,
    @Param('submissionId') submissionId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.submissions.deleteSubmission(slug, submissionId, req.user.id);
  }

  @Delete(':slug/submissions')
  @FormPermission('manage')
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
  @FormPermission('view')
  async export(@Param('slug') slug: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const csv = await this.submissions.exportCsv(slug, req.user.id);
    res
      .type('text/csv')
      .setHeader('Content-Disposition', `attachment; filename="${slug}-submissions.csv"`)
      .send(csv);
  }

  @Get(':slug/submissions/export.xlsx')
  @FormPermission('view')
  async exportXlsx(@Param('slug') slug: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const buffer = await this.submissions.exportXlsx(slug, req.user.id);
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${slug}-submissions.xlsx"`)
      .send(buffer);
  }

  /** Summary report (not raw rows, unlike the exports above) as a PDF. */
  @Get(':slug/submissions/export.pdf')
  @FormPermission('view')
  async exportPdf(@Param('slug') slug: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const buffer = await this.submissions.exportPdf(slug, req.user.id);
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${slug}-summary.pdf"`)
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

  /** Token-gated live export — paste into Excel's "Get Data from Web" and refresh anytime.
   *  The unguessable token IS the access control, same trust model as the public fill link. */
  @Public()
  @Get('export/:exportToken')
  async exportXlsx(@Param('exportToken') exportToken: string, @Res() res: Response) {
    const { form } = await this.forms.getByExportToken(exportToken);
    const buffer = await this.submissions.exportXlsx(form.slug, null);
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${form.slug}-live.xlsx"`)
      .send(buffer);
  }

  @Public()
  @Post(':token/submissions')
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // spam brake per IP
  submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(submissionAnswersSchema)) answers: SubmissionAnswers,
    @Headers('x-turnstile-token') turnstileToken: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fingerprint = req.cookies?.[RESPONDENT_COOKIE] ?? randomBytes(16).toString('base64url');
    res.cookie(RESPONDENT_COOKIE, fingerprint, respondentCookieOptions);
    return this.submissions.submitPublic(token, answers, fingerprint, turnstileToken);
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

  /** Prefills the respondent's own edit form. Same access model as updateByEditToken below. */
  @Public()
  @Get(':token/submissions/:editToken')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  getByEditToken(@Param('token') token: string, @Param('editToken') editToken: string) {
    return this.submissions.getByEditToken(token, editToken);
  }

  /** Respondent self-edit — only reachable when the form's `allowRespondentEdit` setting is on
   *  and the caller has the edit token returned at submit time; see SubmissionsService.persist. */
  @Public()
  @Patch(':token/submissions/:editToken')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  updateByEditToken(
    @Param('token') token: string,
    @Param('editToken') editToken: string,
    @Body(new ZodValidationPipe(submissionAnswersSchema)) answers: SubmissionAnswers,
  ) {
    return this.submissions.updateByEditToken(token, editToken, answers);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  CreateSubCriteriaInput,
  DashboardFormScopeInput,
  KpiAssignmentInput,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  SetEvaluationAreaStatusInput,
  SetKpiStatusInput,
  UpdateEvaluationAreaEntryInput,
  UpdateEvaluationAreaInput,
  UpdateKpiInput,
  UpdateSubCriteriaInput,
  createEvaluationAreaSchema,
  createKpiSchema,
  createSubCriteriaSchema,
  dashboardFormScopeSchema,
  kpiAssignmentSchema,
  recordEvaluationAreaEntrySchema,
  setEvaluationAreaStatusSchema,
  setKpiStatusSchema,
  updateEvaluationAreaEntrySchema,
  updateEvaluationAreaSchema,
  updateKpiSchema,
  updateSubCriteriaSchema,
} from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { KpisService } from './kpis.service';

type AuthedRequest = { user: { id: string } };

@Controller('v1/kpis')
export class KpisController {
  constructor(private readonly kpis: KpisService) {}

  @Post()
  @RequirePermissions('kpis:edit')
  create(@Body(new ZodValidationPipe(createKpiSchema)) input: CreateKpiInput, @Req() req: AuthedRequest) {
    return this.kpis.createKpi(input, req.user.id);
  }

  @Get()
  @RequirePermissions('kpis:view')
  list(@Query() query: PageQuery, @Req() req: AuthedRequest) {
    return this.kpis.list(query, req.user.id);
  }

  /** KPIs scoped to the caller's own roles/department — powers "my dashboard". */
  @Get('my')
  @RequirePermissions('kpis:view')
  listMine(@Req() req: AuthedRequest) {
    return this.kpis.listMine(req.user.id);
  }

  /** Every active user with their coverage/score/last-updated — powers the admin
   *  dashboard's team overview table. Dashboard data, not KPI administration —
   *  gated on dashboards:view rather than kpis:*. */
  @Get('team-overview')
  @RequirePermissions('dashboards:view')
  getTeamOverview(@Req() req: AuthedRequest) {
    return this.kpis.getTeamOverview(req.user.id);
  }

  /** One team member's own rate across every covering KPI — powers the team overview table's row detail drawer. */
  @Get('team-overview/:personId')
  @RequirePermissions('dashboards:view')
  getPersonBreakdown(@Param('personId') personId: string, @Req() req: AuthedRequest) {
    return this.kpis.getPersonBreakdown(personId, req.user.id);
  }

  /** Unmapped score-eligible questions + stale Evaluation Areas, org-wide — powers the dashboard's measurement-gap panel. */
  @Get('measurement-gaps')
  @RequirePermissions('dashboards:view')
  getMeasurementGaps() {
    return this.kpis.getMeasurementGaps();
  }

  /** Recent context/comment feedback, org-wide or scoped to one KPI — powers the dashboard's qualitative feedback digest. */
  @Get('recent-feedback')
  @RequirePermissions('dashboards:view')
  getRecentFeedback(@Query('kpiId') kpiId?: string) {
    return this.kpis.getRecentFeedback(kpiId);
  }

  /** Weekly count of new Evaluation Area entries, org-wide — powers the dashboard's evaluation activity trend chart. */
  @Get('activity-trend')
  @RequirePermissions('dashboards:view')
  getActivityTrend() {
    return this.kpis.getActivityTrend();
  }

  /** Which forms' submissions currently feed the dashboard — readable by
   *  anyone who can see the dashboard, so the picker can show the active
   *  state even to a viewer who can't change it. */
  @Get('dashboard-form-scope')
  @RequirePermissions('dashboards:view')
  getDashboardFormScope() {
    return this.kpis.getDashboardFormScope();
  }

  /** Global, org-wide — not per-caller — see DashboardFormScope. */
  @Put('dashboard-form-scope')
  @RequirePermissions('dashboards:edit')
  setDashboardFormScope(
    @Body(new ZodValidationPipe(dashboardFormScopeSchema)) input: DashboardFormScopeInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.setDashboardFormScope(input, req.user.id);
  }

  @Patch(':id')
  @RequirePermissions('kpis:edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateKpiSchema)) input: UpdateKpiInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.updateKpi(id, input, req.user.id);
  }

  @Patch(':id/status')
  @RequirePermissions('kpis:activate_deactivate')
  setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setKpiStatusSchema)) input: SetKpiStatusInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.setKpiStatus(id, input, req.user.id);
  }

  @Delete(':id')
  @RequirePermissions('kpis:delete')
  remove(@Param('id') id: string, @Query('force') force: string | undefined, @Req() req: AuthedRequest) {
    return this.kpis.deleteKpi(id, req.user.id, force === 'true');
  }

  @Post(':kpiId/assignments')
  @RequirePermissions('kpis:edit')
  assign(
    @Param('kpiId') kpiId: string,
    @Body(new ZodValidationPipe(kpiAssignmentSchema)) input: KpiAssignmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.assign(kpiId, input, req.user.id);
  }

  @Delete(':kpiId/assignments/:assignmentId')
  @RequirePermissions('kpis:edit')
  unassign(@Param('kpiId') kpiId: string, @Param('assignmentId') assignmentId: string, @Req() req: AuthedRequest) {
    return this.kpis.unassign(kpiId, assignmentId, req.user.id);
  }

  @Post(':kpiId/areas')
  @RequirePermissions('kpis:edit')
  createArea(
    @Param('kpiId') kpiId: string,
    @Body(new ZodValidationPipe(createEvaluationAreaSchema)) input: CreateEvaluationAreaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.createEvaluationArea(kpiId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId')
  @RequirePermissions('kpis:edit')
  updateArea(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(updateEvaluationAreaSchema)) input: UpdateEvaluationAreaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.updateEvaluationArea(kpiId, areaId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId/status')
  @RequirePermissions('kpis:activate_deactivate')
  setAreaStatus(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(setEvaluationAreaStatusSchema)) input: SetEvaluationAreaStatusInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.setEvaluationAreaStatus(kpiId, areaId, input, req.user.id);
  }

  @Delete(':kpiId/areas/:areaId')
  @RequirePermissions('kpis:delete')
  removeArea(@Param('kpiId') kpiId: string, @Param('areaId') areaId: string, @Req() req: AuthedRequest) {
    return this.kpis.deleteEvaluationArea(kpiId, areaId, req.user.id);
  }

  @Post(':kpiId/areas/:areaId/sub-criteria')
  @RequirePermissions('kpis:edit')
  createSubCriteria(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(createSubCriteriaSchema)) input: CreateSubCriteriaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.createSubCriteria(kpiId, areaId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId/sub-criteria/:subCriteriaId')
  @RequirePermissions('kpis:edit')
  updateSubCriteria(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Param('subCriteriaId') subCriteriaId: string,
    @Body(new ZodValidationPipe(updateSubCriteriaSchema)) input: UpdateSubCriteriaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.updateSubCriteria(kpiId, areaId, subCriteriaId, input, req.user.id);
  }

  @Delete(':kpiId/areas/:areaId/sub-criteria/:subCriteriaId')
  @RequirePermissions('kpis:delete')
  removeSubCriteria(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Param('subCriteriaId') subCriteriaId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.deleteSubCriteria(kpiId, areaId, subCriteriaId, req.user.id);
  }

  @Post(':kpiId/areas/:areaId/entries')
  @RequirePermissions('kpi_entries:edit')
  recordEntry(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(recordEvaluationAreaEntrySchema)) input: RecordEvaluationAreaEntryInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.recordEntry(kpiId, areaId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId/entries/:entryId')
  @RequirePermissions('kpi_entries:edit')
  updateEntry(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Param('entryId') entryId: string,
    @Body(new ZodValidationPipe(updateEvaluationAreaEntrySchema)) input: UpdateEvaluationAreaEntryInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.updateEntry(kpiId, areaId, entryId, input, req.user.id);
  }

  @Delete(':kpiId/areas/:areaId/entries/:entryId')
  @RequirePermissions('kpi_entries:delete')
  removeEntry(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Param('entryId') entryId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.deleteEntry(kpiId, areaId, entryId, req.user.id);
  }

  @Get(':kpiId/areas/:areaId/series')
  @RequirePermissions('kpis:view', 'kpi_entries:view')
  series(@Param('kpiId') kpiId: string, @Param('areaId') areaId: string, @Query('personId') personId?: string) {
    return this.kpis.getSeries(kpiId, areaId, personId);
  }
}

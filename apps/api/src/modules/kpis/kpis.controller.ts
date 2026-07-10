import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  CreateSubCriteriaInput,
  KpiAssignmentInput,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  UpdateEvaluationAreaEntryInput,
  UpdateEvaluationAreaInput,
  UpdateKpiInput,
  UpdateSubCriteriaInput,
  createEvaluationAreaSchema,
  createKpiSchema,
  createSubCriteriaSchema,
  kpiAssignmentSchema,
  recordEvaluationAreaEntrySchema,
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
  @RequirePermissions('kpis:write')
  create(@Body(new ZodValidationPipe(createKpiSchema)) input: CreateKpiInput, @Req() req: AuthedRequest) {
    return this.kpis.createKpi(input, req.user.id);
  }

  @Get()
  @RequirePermissions('kpis:read')
  list(@Query() query: PageQuery, @Req() req: AuthedRequest) {
    return this.kpis.list(query, req.user.id);
  }

  /** KPIs scoped to the caller's own roles/department — powers "my dashboard". */
  @Get('my')
  @RequirePermissions('kpis:read')
  listMine(@Req() req: AuthedRequest) {
    return this.kpis.listMine(req.user.id);
  }

  @Patch(':id')
  @RequirePermissions('kpis:write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateKpiSchema)) input: UpdateKpiInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.updateKpi(id, input, req.user.id);
  }

  @Delete(':id')
  @RequirePermissions('kpis:manage')
  remove(@Param('id') id: string, @Query('force') force: string | undefined, @Req() req: AuthedRequest) {
    return this.kpis.deleteKpi(id, req.user.id, force === 'true');
  }

  @Post(':kpiId/assignments')
  @RequirePermissions('kpis:manage')
  assign(
    @Param('kpiId') kpiId: string,
    @Body(new ZodValidationPipe(kpiAssignmentSchema)) input: KpiAssignmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.assign(kpiId, input, req.user.id);
  }

  @Post(':kpiId/areas')
  @RequirePermissions('kpis:write')
  createArea(
    @Param('kpiId') kpiId: string,
    @Body(new ZodValidationPipe(createEvaluationAreaSchema)) input: CreateEvaluationAreaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.createEvaluationArea(kpiId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId')
  @RequirePermissions('kpis:write')
  updateArea(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(updateEvaluationAreaSchema)) input: UpdateEvaluationAreaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.updateEvaluationArea(kpiId, areaId, input, req.user.id);
  }

  @Delete(':kpiId/areas/:areaId')
  @RequirePermissions('kpis:manage')
  removeArea(@Param('kpiId') kpiId: string, @Param('areaId') areaId: string, @Req() req: AuthedRequest) {
    return this.kpis.deleteEvaluationArea(kpiId, areaId, req.user.id);
  }

  @Post(':kpiId/areas/:areaId/sub-criteria')
  @RequirePermissions('kpis:write')
  createSubCriteria(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(createSubCriteriaSchema)) input: CreateSubCriteriaInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.createSubCriteria(kpiId, areaId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId/sub-criteria/:subCriteriaId')
  @RequirePermissions('kpis:write')
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
  @RequirePermissions('kpis:manage')
  removeSubCriteria(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Param('subCriteriaId') subCriteriaId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.deleteSubCriteria(kpiId, areaId, subCriteriaId, req.user.id);
  }

  @Post(':kpiId/areas/:areaId/entries')
  @RequirePermissions('kpi_entries:write')
  recordEntry(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(recordEvaluationAreaEntrySchema)) input: RecordEvaluationAreaEntryInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.recordEntry(kpiId, areaId, input, req.user.id);
  }

  @Patch(':kpiId/areas/:areaId/entries/:entryId')
  @RequirePermissions('kpi_entries:write')
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
  @RequirePermissions('kpi_entries:manage')
  removeEntry(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Param('entryId') entryId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.deleteEntry(kpiId, areaId, entryId, req.user.id);
  }

  @Get(':kpiId/areas/:areaId/series')
  @RequirePermissions('kpis:read', 'kpi_entries:read')
  series(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Query('personId') personId?: string,
  ) {
    return this.kpis.getSeries(kpiId, areaId, personId);
  }
}

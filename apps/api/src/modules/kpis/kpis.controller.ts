import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  KpiAssignmentInput,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  UpdateEvaluationAreaInput,
  UpdateKpiInput,
  createEvaluationAreaSchema,
  createKpiSchema,
  kpiAssignmentSchema,
  recordEvaluationAreaEntrySchema,
  updateEvaluationAreaSchema,
  updateKpiSchema,
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
  create(@Body(new ZodValidationPipe(createKpiSchema)) input: CreateKpiInput) {
    return this.kpis.createKpi(input);
  }

  @Get()
  @RequirePermissions('kpis:read')
  list(@Query() query: PageQuery) {
    return this.kpis.list(query);
  }

  /** KPIs scoped to the caller's own roles/department — powers "my dashboard". */
  @Get('my')
  @RequirePermissions('kpis:read')
  listMine(@Req() req: AuthedRequest) {
    return this.kpis.listMine(req.user.id);
  }

  @Patch(':id')
  @RequirePermissions('kpis:write')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateKpiSchema)) input: UpdateKpiInput) {
    return this.kpis.updateKpi(id, input);
  }

  @Delete(':id')
  @RequirePermissions('kpis:manage')
  remove(@Param('id') id: string) {
    return this.kpis.deleteKpi(id);
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
  ) {
    return this.kpis.createEvaluationArea(kpiId, input);
  }

  @Patch(':kpiId/areas/:areaId')
  @RequirePermissions('kpis:write')
  updateArea(
    @Param('kpiId') kpiId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(updateEvaluationAreaSchema)) input: UpdateEvaluationAreaInput,
  ) {
    return this.kpis.updateEvaluationArea(kpiId, areaId, input);
  }

  @Delete(':kpiId/areas/:areaId')
  @RequirePermissions('kpis:manage')
  removeArea(@Param('kpiId') kpiId: string, @Param('areaId') areaId: string) {
    return this.kpis.deleteEvaluationArea(kpiId, areaId);
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

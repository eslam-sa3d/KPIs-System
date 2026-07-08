import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  CreateKpiInput,
  KpiAssignmentInput,
  PageQuery,
  RecordKpiEntryInput,
  createKpiSchema,
  kpiAssignmentSchema,
  recordKpiEntrySchema,
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

  @Post(':kpiId/assignments')
  @RequirePermissions('kpis:manage')
  assign(
    @Param('kpiId') kpiId: string,
    @Body(new ZodValidationPipe(kpiAssignmentSchema)) input: KpiAssignmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.assign(kpiId, input, req.user.id);
  }

  @Post(':kpiId/entries')
  @RequirePermissions('kpi_entries:write')
  recordEntry(
    @Param('kpiId') kpiId: string,
    @Body(new ZodValidationPipe(recordKpiEntrySchema)) input: RecordKpiEntryInput,
    @Req() req: AuthedRequest,
  ) {
    return this.kpis.recordEntry(kpiId, input, req.user.id);
  }

  @Get(':kpiId/series')
  @RequirePermissions('kpis:read', 'kpi_entries:read')
  series(@Param('kpiId') kpiId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.kpis.getSeries(kpiId, from, to);
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreatePerformanceLevelInput, UpdatePerformanceLevelInput } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

function serialize<T extends { minScore: Prisma.Decimal; maxScore: Prisma.Decimal }>(
  level: T,
): Omit<T, 'minScore' | 'maxScore'> & { minScore: number; maxScore: number } {
  return { ...level, minScore: Number(level.minScore), maxScore: Number(level.maxScore) };
}

/** The Configuration page's Performance Levels tab: named bands over the
 *  0-5 EvaluationAreaEntry score range (e.g. 4.0-5.0 = "Outstanding"). */
@Injectable()
export class PerformanceLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const levels = await this.prisma.performanceLevel.findMany({ orderBy: { minScore: 'desc' } });
    return levels.map(serialize);
  }

  async create(input: CreatePerformanceLevelInput, actorId: string) {
    const level = await this.prisma.performanceLevel.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'performance_level.created', entity: 'PerformanceLevel', entityId: level.id },
    });
    return serialize(level);
  }

  async update(levelId: string, input: UpdatePerformanceLevelInput, actorId: string) {
    const level = await this.prisma.performanceLevel.findUnique({ where: { id: levelId } });
    if (!level) throw AppError.notFound('PerformanceLevel', levelId);

    const nextMin = input.minScore ?? Number(level.minScore);
    const nextMax = input.maxScore ?? Number(level.maxScore);
    if (nextMax < nextMin) {
      throw AppError.validation([{ path: 'maxScore', message: 'maxScore must be greater than or equal to minScore' }]);
    }

    const updated = await this.prisma.performanceLevel.update({ where: { id: levelId }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'performance_level.updated', entity: 'PerformanceLevel', entityId: levelId },
    });
    return serialize(updated);
  }

  async remove(levelId: string, actorId: string) {
    const level = await this.prisma.performanceLevel.findUnique({ where: { id: levelId } });
    if (!level) throw AppError.notFound('PerformanceLevel', levelId);
    await this.prisma.performanceLevel.delete({ where: { id: levelId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'performance_level.deleted', entity: 'PerformanceLevel', entityId: levelId },
    });
    return null;
  }
}

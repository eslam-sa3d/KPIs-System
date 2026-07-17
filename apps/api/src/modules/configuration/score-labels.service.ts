import { Injectable } from '@nestjs/common';
import { CreateScoreLabelInput, UpdateScoreLabelInput } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

/** The Configuration page's Score Labels tab: named points on the 0-5
 *  EvaluationAreaEntry score scale (e.g. 5 = "Outstanding"). */
@Injectable()
export class ScoreLabelsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.scoreLabel.findMany({ orderBy: { score: 'desc' } });
  }

  async create(input: CreateScoreLabelInput, actorId: string) {
    const level = await this.prisma.scoreLabel.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'score_label.created', entity: 'ScoreLabel', entityId: level.id },
    });
    return level;
  }

  async update(labelId: string, input: UpdateScoreLabelInput, actorId: string) {
    const level = await this.prisma.scoreLabel.findUnique({ where: { id: labelId } });
    if (!level) throw AppError.notFound('ScoreLabel', labelId);

    const updated = await this.prisma.scoreLabel.update({ where: { id: labelId }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'score_label.updated', entity: 'ScoreLabel', entityId: labelId },
    });
    return updated;
  }

  async remove(labelId: string, actorId: string) {
    const level = await this.prisma.scoreLabel.findUnique({ where: { id: labelId } });
    if (!level) throw AppError.notFound('ScoreLabel', labelId);
    await this.prisma.scoreLabel.delete({ where: { id: labelId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'score_label.deleted', entity: 'ScoreLabel', entityId: labelId },
    });
    return null;
  }
}

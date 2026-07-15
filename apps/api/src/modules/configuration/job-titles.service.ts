import { Injectable } from '@nestjs/common';
import { CreateJobTitleInput, UpdateJobTitleInput } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

/** The Configuration page's Job Titles tab: a plain named list, no score range. */
@Injectable()
export class JobTitlesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.jobTitle.findMany({ orderBy: { label: 'asc' } });
  }

  async create(input: CreateJobTitleInput, actorId: string) {
    const jobTitle = await this.prisma.jobTitle.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'job_title.created', entity: 'JobTitle', entityId: jobTitle.id },
    });
    return jobTitle;
  }

  async update(jobTitleId: string, input: UpdateJobTitleInput, actorId: string) {
    const jobTitle = await this.prisma.jobTitle.findUnique({ where: { id: jobTitleId } });
    if (!jobTitle) throw AppError.notFound('JobTitle', jobTitleId);

    const updated = await this.prisma.jobTitle.update({ where: { id: jobTitleId }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'job_title.updated', entity: 'JobTitle', entityId: jobTitleId },
    });
    return updated;
  }

  async remove(jobTitleId: string, actorId: string) {
    const jobTitle = await this.prisma.jobTitle.findUnique({ where: { id: jobTitleId } });
    if (!jobTitle) throw AppError.notFound('JobTitle', jobTitleId);
    await this.prisma.jobTitle.delete({ where: { id: jobTitleId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'job_title.deleted', entity: 'JobTitle', entityId: jobTitleId },
    });
    return null;
  }
}

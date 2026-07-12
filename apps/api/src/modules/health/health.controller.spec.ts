import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let redis: { ping: ReturnType<typeof vi.fn> };
  let controller: HealthController;

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redis = { ping: vi.fn().mockResolvedValue('PONG') };
    controller = new HealthController(prisma as never, redis as never);
  });

  it('reports ok when both Postgres and Redis answer', async () => {
    await expect(controller.health()).resolves.toEqual({ status: 'ok' });
  });

  it('throws 503 when Postgres is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(controller.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.health()).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503 when Redis is unreachable', async () => {
    redis.ping.mockRejectedValue(new Error('connection refused'));

    await expect(controller.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws 503 when Redis answers but not with PONG', async () => {
    redis.ping.mockResolvedValue('WRONG');

    await expect(controller.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('names both dependencies in the error message when both are down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('down'));
    redis.ping.mockRejectedValue(new Error('down'));

    await expect(controller.health()).rejects.toMatchObject({
      message: 'Not ready — unreachable: database, redis',
    });
  });
});

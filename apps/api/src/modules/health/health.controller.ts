import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';

/** Readiness probe for CI wait-on, Render's healthCheckPath, and load
 *  balancers — actually reaches Postgres and Redis rather than trivially
 *  returning 'ok', so a downed dependency shows up here (and takes the
 *  instance out of rotation / triggers a restart) instead of only failing
 *  later, request by request. */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health() {
    const [databaseOk, redisOk] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    if (databaseOk && redisOk) return { status: 'ok' as const };

    const down = [!databaseOk && 'database', !redisOk && 'redis'].filter(Boolean).join(', ');
    throw new ServiceUnavailableException(`Not ready — unreachable: ${down}`);
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      this.logger.error(`Database health check failed: ${err}`);
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch (err) {
      this.logger.error(`Redis health check failed: ${err}`);
      return false;
    }
  }
}

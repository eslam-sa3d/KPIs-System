import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';
import { FormsController } from './modules/forms/forms.controller';
import { FormsService } from './modules/forms/forms.service';
import { SubmissionsService } from './modules/forms/submissions.service';
import { PermissionsGuard } from './modules/rbac/permissions.guard';
import { RbacService } from './modules/rbac/rbac.service';
import { RolesController } from './modules/rbac/roles.controller';

@Module({
  imports: [
    // Global rate limiting; /auth routes get a tighter override in AuthModule.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [RolesController, FormsController],
  providers: [
    PrismaService,
    RedisService,
    RbacService,
    FormsService,
    SubmissionsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // AuthGuard (JWT) registers here as well, before PermissionsGuard.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

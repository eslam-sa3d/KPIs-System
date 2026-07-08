import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { PasswordHasher } from './modules/auth/password-hasher';
import { FormsController } from './modules/forms/forms.controller';
import { FormsService } from './modules/forms/forms.service';
import { SubmissionsService } from './modules/forms/submissions.service';
import { HealthController } from './modules/health/health.controller';
import { KpisController } from './modules/kpis/kpis.controller';
import { KpisService } from './modules/kpis/kpis.service';
import { PermissionsGuard } from './modules/rbac/permissions.guard';
import { RbacService } from './modules/rbac/rbac.service';
import { RolesController } from './modules/rbac/roles.controller';

@Module({
  imports: [
    // Global rate limiting; auth endpoints declare tighter @Throttle overrides.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { issuer: 'pulse-kpi' },
      verifyOptions: { issuer: 'pulse-kpi' },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    RolesController,
    KpisController,
    FormsController,
  ],
  providers: [
    PrismaService,
    RedisService,
    PasswordHasher,
    AuthService,
    RbacService,
    KpisService,
    FormsService,
    SubmissionsService,
    // Guard chain runs in registration order:
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // 1. rate limit
    { provide: APP_GUARD, useClass: JwtAuthGuard },   // 2. authenticate (@Public opts out)
    { provide: APP_GUARD, useClass: PermissionsGuard }, // 3. authorize (@RequirePermissions)
  ],
})
export class AppModule {}

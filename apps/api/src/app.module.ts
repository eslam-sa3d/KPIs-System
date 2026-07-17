import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './infra/env';
import { MailerService } from './infra/mailer.service';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { PasswordHasher } from './modules/auth/password-hasher';
import { BrandingController } from './modules/branding/branding.controller';
import { JobTitlesController } from './modules/configuration/job-titles.controller';
import { JobTitlesService } from './modules/configuration/job-titles.service';
import { PerformanceLevelsController } from './modules/configuration/performance-levels.controller';
import { PerformanceLevelsService } from './modules/configuration/performance-levels.service';
import { ScoreLabelsController } from './modules/configuration/score-labels.controller';
import { ScoreLabelsService } from './modules/configuration/score-labels.service';
import { DemoDataService } from './modules/settings/demo-data.service';
import { SettingsController } from './modules/settings/settings.controller';
import { DepartmentsController, ProjectGroupsController, UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { FormsController, PublicFormsController } from './modules/forms/forms.controller';
import { AssetsService } from './modules/forms/assets.service';
import { FileUploadsService } from './modules/forms/file-uploads.service';
import { FormAccessGuard } from './modules/forms/form-access.guard';
import { FormKpiMappingsService } from './modules/forms/form-kpi-mappings.service';
import { FormsService } from './modules/forms/forms.service';
import { SubmissionsService } from './modules/forms/submissions.service';
import { TurnstileService } from './modules/forms/turnstile.service';
import { HealthController } from './modules/health/health.controller';
import { KpisController } from './modules/kpis/kpis.controller';
import { KpisService } from './modules/kpis/kpis.service';
import { PermissionsGuard } from './modules/rbac/permissions.guard';
import { RbacService } from './modules/rbac/rbac.service';
import { RolesController } from './modules/rbac/roles.controller';

@Module({
  imports: [
    // Global rate limiting; auth endpoints declare tighter @Throttle overrides.
    // Backed by Redis (not the default in-memory store) so limits are shared
    // across horizontally-scaled instances rather than counted per-process.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      storage: new ThrottlerStorageRedisService(env.REDIS_URL),
    }),
    // Powers @Cron in FileUploadsService/AssetsService (orphaned-upload sweeps).
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: env.JWT_SECRET,
      signOptions: { issuer: 'pulse-kpi' },
      verifyOptions: { issuer: 'pulse-kpi' },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    DepartmentsController,
    ProjectGroupsController,
    RolesController,
    KpisController,
    FormsController,
    PublicFormsController,
    BrandingController,
    SettingsController,
    PerformanceLevelsController,
    ScoreLabelsController,
    JobTitlesController,
  ],
  providers: [
    PrismaService,
    RedisService,
    MailerService,
    PasswordHasher,
    AuthService,
    UsersService,
    RbacService,
    KpisService,
    FormsService,
    FormKpiMappingsService,
    SubmissionsService,
    TurnstileService,
    FileUploadsService,
    AssetsService,
    DemoDataService,
    PerformanceLevelsService,
    ScoreLabelsService,
    JobTitlesService,
    // Guard chain runs in registration order:
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // 1. rate limit
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // 2. authenticate (@Public opts out)
    { provide: APP_GUARD, useClass: PermissionsGuard }, // 3. authorize (@RequirePermissions)
    { provide: APP_GUARD, useClass: FormAccessGuard }, // 4. narrow further for restricted forms
  ],
})
export class AppModule {}

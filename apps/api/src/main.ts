import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiEnvelopeInterceptor } from './common/envelope.interceptor';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { env } from './infra/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers: CSP, HSTS, X-Content-Type-Options, frameguard…
  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  // Contract enforcement: every response and every error goes through these.
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

void bootstrap();

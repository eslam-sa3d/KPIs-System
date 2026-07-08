import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public_route';

/** Opts a route out of the global JwtAuthGuard (login, refresh, health…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenClaims } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global authentication guard: every route requires a valid Bearer access
 * token unless marked @Public(). Attaches `req.user = { id, email }` for
 * downstream guards (PermissionsGuard) and controllers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = String(request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      request.user = { id: claims.sub, email: claims.email };
      return true;
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Access token is invalid or expired');
    }
  }
}

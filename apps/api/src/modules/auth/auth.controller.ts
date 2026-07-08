import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LoginInput, TokenGrant, loginSchema } from '@pulse/contracts';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService, GrantWithRefresh } from './auth.service';
import { Public } from './public.decorator';

export const REFRESH_COOKIE = 'pulse_rt';

/**
 * The refresh token only ever travels on the auth endpoints, over an httpOnly
 * cookie — invisible to JS, never in JSON.
 *
 * SameSite is deployment-dependent: 'strict' when web and API share a site;
 * 'none' when they are cross-site (e.g. *.onrender.com subdomains are separate
 * sites — the Public Suffix List splits them — as is Pages → Render). 'none'
 * stays CSRF-safe here because CORS is allowlisted and every mutating endpoint
 * authenticates via the Authorization header, not this cookie.
 */
const sameSite = (process.env.REFRESH_COOKIE_SAMESITE ?? 'strict') as 'strict' | 'lax' | 'none';
const refreshCookieOptions = {
  httpOnly: true,
  // browsers reject SameSite=None without Secure
  secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
  sameSite,
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // brute-force brake
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenGrant> {
    const result = await this.auth.login(input.email, input.password, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return this.attachRefreshCookie(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenGrant> {
    const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return this.attachRefreshCookie(res, result);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<null> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
    return null;
  }

  @Get('me')
  me(@Req() req: Request & { user: { id: string } }) {
    return this.auth.getProfile(req.user.id);
  }

  private attachRefreshCookie(res: Response, { grant, refreshToken }: GrantWithRefresh): TokenGrant {
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    return grant;
  }
}

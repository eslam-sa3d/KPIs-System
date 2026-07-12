import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * JwtAuthGuard is the first gate every request passes through (registered
 * globally as APP_GUARD, ahead of PermissionsGuard) — it's what "the whole
 * API requires a valid token" actually rests on. Tested directly here the
 * same way PermissionsGuard/FormAccessGuard already are, rather than only
 * indirectly via the live integration suite's 401 assertions.
 */
function makeContext(opts: { isPublic?: boolean; authorizationHeader?: string }) {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: opts.authorizationHeader !== undefined ? { authorization: opts.authorizationHeader } : {},
  };
  return {
    reflector: { getAllAndOverride: vi.fn().mockReturnValue(opts.isPublic) },
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
    request,
  };
}

describe('JwtAuthGuard', () => {
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwt = { verifyAsync: vi.fn() };
  });

  it('allows a @Public() route through without even checking the Authorization header', async () => {
    const { reflector, context } = makeContext({ isPublic: true });
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header at all', async () => {
    const { reflector, context } = makeContext({ isPublic: false });
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a header using a non-Bearer scheme', async () => {
    const { reflector, context } = makeContext({ isPublic: false, authorizationHeader: 'Basic dXNlcjpwYXNz' });
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects "Bearer" with no token after it', async () => {
    const { reflector, context } = makeContext({ isPublic: false, authorizationHeader: 'Bearer' });
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an expired or otherwise invalid token (verifyAsync throws) without leaking the underlying error', async () => {
    const { reflector, context } = makeContext({ isPublic: false, authorizationHeader: 'Bearer a.b.c' });
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Access token is invalid or expired',
    });
  });

  it('accepts a valid token and attaches { id, email } from its claims to the request', async () => {
    const { reflector, context, request } = makeContext({ isPublic: false, authorizationHeader: 'Bearer a.b.c' });
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@pulse.local' });
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'a@pulse.local' });
  });

  it('checks @Public() at both the handler and the class level (getAllAndOverride)', async () => {
    const { reflector, context } = makeContext({ isPublic: true });
    const guard = new JwtAuthGuard(reflector as never, jwt as never);

    await guard.canActivate(context);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(expect.anything(), [expect.anything(), expect.anything()]);
  });
});

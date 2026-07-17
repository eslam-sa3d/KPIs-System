import { vi } from 'vitest';

function createAutoMock(): Record<string, unknown> {
  const cache: Record<string, unknown> = {};
  return new Proxy(cache, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!(prop in target)) target[prop] = vi.fn();
      return target[prop];
    },
  });
}

/** Deep auto-mocking PrismaService stub: every `prisma.<model>.<method>(...)`
 *  resolves to its own fresh `vi.fn()` on first access, and `$transaction`
 *  is itself a top-level `vi.fn()` — so spec files no longer need to
 *  hand-enumerate every model/method they touch. Call `.mockResolvedValue(...)`
 *  / `.mockImplementation(...)` on the accessed path as usual; assert with
 *  `.toHaveBeenCalledWith(...)`. For a method with a custom default return
 *  value (e.g. echoing back `data` on `create`), set that up explicitly in
 *  the test rather than relying on this helper, which only auto-vivifies
 *  bare `vi.fn()`s. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic mock shape, narrowed by callers via `as never`
export function createPrismaMock(): Record<string, any> {
  const models: Record<string, unknown> = { $transaction: vi.fn() };
  return new Proxy(models, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (prop === '$transaction') return target.$transaction;
      if (!(prop in target)) target[prop as string] = createAutoMock();
      return target[prop as string];
    },
  });
}

/** Deep auto-mocking Redis client stub — same auto-vivification as
 *  {@link createPrismaMock}, one flat level (no model namespacing). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic mock shape, narrowed by callers via `as never`
export function createRedisMock(): Record<string, any> {
  return createAutoMock();
}

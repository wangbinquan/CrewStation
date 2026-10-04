import { expect, test } from 'bun:test';
import { withDeletionOwnerLease } from '../application/deletion/ownerLease';

test('owner completion retains an already issued renewal before allowing its phase receipt', async () => {
  const entered = Promise.withResolvers<void>(), renewal = Promise.withResolvers<void>(), callback = Promise.withResolvers<string>();
  let returned = false;
  const running = withDeletionOwnerLease(async () => { entered.resolve(); await renewal.promise; }, () => callback.promise, 20).then((value) => { returned = true; return value; });
  await entered.promise; callback.resolve('original-owner-completed'); await Promise.resolve();
  expect(returned).toBe(false);
  renewal.resolve(); expect(await running).toBe('original-owner-completed'); expect(returned).toBe(true);
});
test('an owner result cannot become a receipt after the original phase or queue lease renewal fails', async () => {
  const entered = Promise.withResolvers<void>(), renewal = Promise.withResolvers<void>();
  const running = withDeletionOwnerLease(async () => { entered.resolve(); await renewal.promise; throw new Error('original current lease lost'); }, async () => {
    await entered.promise; return 'finished-but-not-authorized';
  }, 20);
  const outcome = running.then(() => undefined, (error: unknown) => error);
  await entered.promise; renewal.resolve();
  expect(await outcome).toBeInstanceOf(Error);
  expect(String(await outcome)).toContain('original current lease lost');
  await expect(withDeletionOwnerLease(async () => undefined, async () => undefined, 0)).rejects.toMatchObject({ kind: 'precondition' });
});

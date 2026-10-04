import { precondition } from '@crewstation/kernel';

/** Retain the same original owner while its full scan runs; never reclaim a replacement operation. */
export async function withDeletionOwnerLease<T>(renew: () => Promise<void>, callback: () => Promise<T>, renewEveryMs = 180_000): Promise<T> {
  if (!Number.isSafeInteger(renewEveryMs) || renewEveryMs < 10) throw precondition('删除参与者续租间隔无效');
  let pending: Promise<void> | undefined, failure: unknown;
  const timer = setInterval(() => {
    if (pending || failure) return;
    pending = renew().catch((error: unknown) => { failure = error; }).finally(() => { pending = undefined; });
  }, renewEveryMs);
  try {
    const value = await callback();
    await pending;
    if (failure) throw failure;
    return value;
  } finally { clearInterval(timer); await pending; }
}

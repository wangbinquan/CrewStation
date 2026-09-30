import type { Logger } from '@crewstation/kernel';

/** 独立于投递进程运行，原 Pod 的 Recreate 不能使停止证明与保护解除互相等待。 */
export function deliveryRecoveryWorker(sweep: () => Promise<void>, logger?: Logger, intervalMs = 5000) {
  let active = false,pending: Promise<void> | undefined,timer: ReturnType<typeof setTimeout> | undefined;
  const runOnce = (): Promise<void> => pending ??= Promise.resolve().then(sweep).catch(() => {
    logger?.warn('event delivery process recovery unavailable',{ code: 'source-unavailable' });
  }).finally(() => { pending = undefined; });
  const tick = async () => { await runOnce(); if (active) timer = setTimeout(tick,intervalMs); };
  return { runOnce,start: () => { if (!active) { active = true; void tick(); } },stop: async () => { active = false; if (timer) clearTimeout(timer); timer = undefined; await pending; } };
}

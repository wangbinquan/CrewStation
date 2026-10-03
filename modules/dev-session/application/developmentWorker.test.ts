import { expect, test } from 'bun:test';
import { developmentWorker } from './developmentWorker';

test('worker stop waits for the source read before callback admission and drains its retained effects afterwards', async () => {
  const entered = Promise.withResolvers<void>(), source = Promise.withResolvers<void>(), effect = Promise.withResolvers<void>();
  let iterations = 0, stopped = false, drainStarted = false;
  const worker = developmentWorker(async () => { iterations++; entered.resolve(); await source.promise; }, 1,
    async () => { drainStarted = true; await effect.promise; }, () => { throw new Error('unexpected iteration failure'); });
  worker.start(); await entered.promise;
  const stop = worker.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped || drainStarted).toBe(false); expect(iterations).toBe(1);
  source.resolve();
  await Promise.resolve(); expect(stopped).toBe(false);
  effect.resolve(); await stop; expect(drainStarted).toBe(true); expect(iterations).toBe(1);
});

test('a failed scheduler is reported once and still drains when stopping repeatedly', async () => {
  const entered = Promise.withResolvers<void>(); let failures = 0, drains = 0;
  const worker = developmentWorker(async () => { entered.resolve(); throw new Error('original selector unavailable'); }, 1,
    async () => { drains++; }, () => { failures++; });
  worker.start(); await entered.promise; await worker.stop(); expect(failures).toBe(1); expect(drains).toBe(1);
  await worker.stop(); expect(failures).toBe(1); expect(drains).toBe(2);
});

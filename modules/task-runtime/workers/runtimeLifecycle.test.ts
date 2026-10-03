import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { runtimeLifecycleWorkers } from './runtimeLifecycle';

test('reconcile and startup observation retain independent original iterations through shutdown', async () => {
  const reconcile = Promise.withResolvers<void>(), observe = Promise.withResolvers<void>();
  let reconciled = 0, observed = 0;
  const [worker, observer] = runtimeLifecycleWorkers(noopLogger, async () => { reconciled++; await reconcile.promise; }, async () => { observed++; await observe.promise; });
  const first = worker!.runOnce(), same = worker!.runOnce(), independent = observer!.runOnce();
  expect(first).toBe(same);
  await Promise.resolve(); expect(reconciled).toBe(1); expect(observed).toBe(1);
  let stopped = false, observationStopped = false;
  const stop = worker!.stop().then(() => { stopped = true; }), observationStop = observer!.stop().then(() => { observationStopped = true; });
  // Clearing the interval must not claim that an already-started original callback or its effects have exited.
  await Promise.resolve(); expect(stopped).toBe(false); expect(observationStopped).toBe(false);
  reconcile.resolve(); await stop; expect(stopped).toBe(true); expect(observationStopped).toBe(false);
  observe.resolve(); await observationStop; await Promise.all([first, same, independent]); expect(observationStopped).toBe(true);
});

test('an exited failing iteration releases its retained lifetime and a later legitimate iteration can run', async () => {
  let called = 0;
  const [worker] = runtimeLifecycleWorkers(noopLogger, async () => { if (++called === 1) throw new Error('original observation failed'); }, async () => undefined);
  await expect(worker!.runOnce()).rejects.toThrow('original observation failed');
  await worker!.stop(); await worker!.runOnce(); expect(called).toBe(2); await worker!.stop();
});

test('real interval ticks do not overlap pending callbacks or restart them after stop', async () => {
  const started = [Promise.withResolvers<void>(), Promise.withResolvers<void>()], exits = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const calls = [0, 0], callbacks = started.map((gate, index) => async () => { calls[index] = (calls[index] ?? 0) + 1; gate.resolve(); await exits[index]!.promise; });
  const workers = runtimeLifecycleWorkers(noopLogger, callbacks[0]!, callbacks[1]!, { reconcileMs: 1, observationMs: 1 });
  try {
    for (const worker of workers) { worker.start(); worker.start(); }
    await Promise.all(started.map((gate) => gate.promise)); await Bun.sleep(20); expect(calls).toEqual([1, 1]);
    const stopped = workers.map((worker) => worker.stop()); exits.forEach((gate) => { gate.resolve(); }); await Promise.all(stopped);
    await Bun.sleep(20); expect(calls).toEqual([1, 1]);
  } finally { exits.forEach((gate) => { gate.resolve(); }); await Promise.all(workers.map((worker) => worker.stop())); }
});

test('both timer error channels observe a failing original iteration while shutdown completes', async () => {
  const failures = [Promise.withResolvers<void>(), Promise.withResolvers<void>()], messages: string[] = [];
  const logger = { ...noopLogger, error: (message: string) => { messages.push(message); failures[message.startsWith('reconcile') ? 0 : 1]!.resolve(); } };
  const workers = runtimeLifecycleWorkers(logger, async () => { throw new Error('reconcile rejected'); }, async () => { throw new Error('observe rejected'); }, { reconcileMs: 1, observationMs: 1 });
  try { workers.forEach((worker) => { worker.start(); }); await Promise.all(failures.map((gate) => gate.promise)); }
  finally { await Promise.all(workers.map((worker) => worker.stop())); }
  expect(messages).toContain('reconcile failed'); expect(messages).toContain('startup observation failed');
});

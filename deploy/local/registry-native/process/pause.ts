import { createHash } from 'node:crypto';
import { RegistryProcessIdentitySchema, assertRegistryThreadsStopped, inspectOriginalRegistryProcess, revalidateOriginalRegistryProcess } from './identity';
import type { RegistryProcessIdentity } from './identity';
import { openRegistryPidfd } from './pidfd';
import type { RegistryPidfd } from './pidfd';
import type { RegistryPauseGuardian } from './guardian';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface OriginalRegistryPause {
  readonly original: RegistryProcessIdentity;
  exclusive<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  assertStopped(signal: AbortSignal): Promise<void>;
  close(): void;
}
export async function originalRegistryPause(raw: RegistryProcessIdentity, driver: { inspect?: typeof inspectOriginalRegistryProcess; current?: typeof revalidateOriginalRegistryProcess; stopped?: typeof assertRegistryThreadsStopped; open?: (original: RegistryProcessIdentity) => Promise<RegistryPidfd>; guardian?: (original: RegistryProcessIdentity) => Promise<RegistryPauseGuardian> } = {}): Promise<OriginalRegistryPause> {
  const original = RegistryProcessIdentitySchema.parse(structuredClone(raw)), inspect = driver.inspect ?? inspectOriginalRegistryProcess, stopped = driver.stopped ?? assertRegistryThreadsStopped;
  const current = driver.current ?? driver.inspect ?? revalidateOriginalRegistryProcess;
  const identity = digest(original), recheck = async (signal?: AbortSignal) => {
    signal?.throwIfAborted(); if (digest(await inspect(original, '/proc', signal)) !== identity) throw Error('Original Registry process birth changed');
  };
  await recheck(); const fd = await (driver.open ?? openRegistryPidfd)(original); let busy = false, paused = false, closed = false;
  const assertStopped = async (signal: AbortSignal) => {
    signal.throwIfAborted(); if (closed || !busy || !paused) throw Error('Original Registry pause has exited');
    await fd.assertAlive(); if (digest(await current(original, '/proc', signal)) !== identity) throw Error('Original Registry process birth changed'); await stopped(original, '/proc', signal); signal.throwIfAborted();
  };
  try { await recheck(); await fd.assertAlive(); } catch (error) { fd.close(); throw error; }
  return { original: structuredClone(original), assertStopped,
    exclusive: async (signal, work) => {
      if (busy || closed) throw Error('Original Registry pause is unavailable'); busy = true;
      let guardian: RegistryPauseGuardian | undefined;
      let currentSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      try { currentSignal.throwIfAborted(); guardian = await driver.guardian?.(original);
        currentSignal = AbortSignal.any([currentSignal, ...(guardian ? [guardian.signal] : [])]);
        await recheck(currentSignal); await fd.assertAlive(); await fd.signal('stop'); paused = true;
        // SIGSTOP delivery is asynchronous. Observe actual stopped threads;
        // elapsed time or a successful signal is never the stop receipt.
        const deadline = Date.now() + 2000;
        for (;;) { currentSignal.throwIfAborted(); try { await assertStopped(currentSignal); break; } catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 10)); } }
        const result = await work(currentSignal); await assertStopped(currentSignal); return result;
      } finally { try { if (paused) await fd.signal('continue'); if (guardian) await guardian.disarm(); } finally { paused = false; busy = false; } }
    },
    close: () => { if (busy || paused) throw Error('Cannot close the original Registry pidfd during its native callback'); if (!closed) { closed = true; fd.close(); } },
  };
}

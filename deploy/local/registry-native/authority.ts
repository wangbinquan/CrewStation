import { NATIVE_REGISTRY_ADMISSION } from '../../../packages/contracts';
import type { ProjectDeletionContext } from '../../../packages/contracts';
import { captureRegistryHistory } from '../../../packages/filesystem-metrics';
import type { RegistryDeletionHistory, RegistryReclamationAuthority } from '../../../packages/filesystem-metrics';
import { withExclusiveDatabaseAdmissionAuthority } from '../../../packages/persistence';
import type { Database, DatabaseAdmissionAuthority } from '../../../packages/persistence';
import { jsonHash } from '../../../packages/kernel';
import type { OriginalRegistryPause } from './process/pause';
import { nativeRegistryConsumerReader } from './consumers';

/** The original PostgreSQL exclusion and original pidfd pause cover the whole
 * native mutation, including each foreign graph recheck and actual finally.
 * Original unlinked inode users are checked in the whole host PID namespace. */
export function nativeRegistryAuthority(input: { db: Database; process: OriginalRegistryPause; signal: AbortSignal;
  context: ProjectDeletionContext; history: RegistryDeletionHistory;
  assertGrant(context: ProjectDeletionContext, signal: AbortSignal): Promise<void>;
  assertOriginalSource(history: RegistryDeletionHistory, signal: AbortSignal): Promise<void>;
  observe?: ReturnType<typeof nativeRegistryConsumerReader>;
}): RegistryReclamationAuthority {
  const history = captureRegistryHistory(input.history), context = structuredClone(input.context), signal = input.signal;
  const original = input.process.original, inspect = input.observe ?? nativeRegistryConsumerReader();
  if (history.projectId !== context.target.id || history.consumers.bootId !== original.bootId || history.consumers.namespace !== original.namespace
    || (history.origin as Record<string, unknown>)['containerId'] !== original.containerId || (history.origin as Record<string, unknown>)['podUid'] !== original.podUid) throw Error('Registry authority is not the original native process and node');
  const expected = jsonHash({ query: history.query, original: history.original }); let authority: DatabaseAdmissionAuthority | undefined, pauseSignal: AbortSignal | undefined;
  const validate = async (currentSignal: AbortSignal) => {
    currentSignal.throwIfAborted(); signal.throwIfAborted(); if (!authority) throw Error('Original Registry exclusive callback has exited');
    await authority.assertActive(); await input.assertGrant(structuredClone(context), currentSignal);
    await input.assertOriginalSource(structuredClone(history), currentSignal); await input.process.assertStopped(currentSignal);
    await authority.assertActive(); currentSignal.throwIfAborted(); signal.throwIfAborted();
  };
  const consumers = async (currentSignal: AbortSignal) => {
    await validate(currentSignal);
    const files = [...history.original.entries.filter(row => row.kind === 'file'), ...history.original.blobs].map(row => ({ device: row.device, inode: row.inode }));
    const users = await inspect([...new Map(files.map(row => [row.device + ':' + row.inode, row])).values()], '/proc', currentSignal);
    if (!users.complete || users.blockers.length || users.bootId !== original.bootId || users.namespace !== original.namespace || users.consumers.length) throw Error('Original Registry files still have native users or incomplete host evidence');
    await validate(currentSignal);
  };
  return {
    exclusive: async (raw, work) => {
      if (jsonHash(raw) !== expected || authority) throw Error('Registry exclusive callback changed its original materials');
      return withExclusiveDatabaseAdmissionAuthority(input.db, NATIVE_REGISTRY_ADMISSION, async actual => {
        await actual.assertActive(); signal.throwIfAborted();
        await input.assertGrant(structuredClone(context), signal); await input.assertOriginalSource(structuredClone(history), signal);
        authority = actual;
        try { return await input.process.exclusive(signal, async bounded => {
          pauseSignal = bounded; await consumers(bounded); const result = await work(); await consumers(bounded); return result;
        }); }
        finally { authority = undefined; pauseSignal = undefined; }
      });
    },
    assertClosed: async (raw, callerSignal) => {
      if (jsonHash(raw) !== expected) throw Error('Registry original erasure query changed');
      if (!pauseSignal) throw Error('Original Registry pause callback has exited');
      // The paused daemon cannot open another payload and the same original
      // PostgreSQL backend excludes every writer. Recheck these before each
      // unlink; scan original inode users around the entire native callback.
      // A reader retaining an unlinked inode prevents the final acknowledgement.
      const currentSignal = AbortSignal.any([signal, callerSignal, pauseSignal]); await validate(currentSignal);
    },
  };
}

import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { ArchiveExecutionApi } from '../../api/archiveExecution';
import type { StorageCleanupApi } from '../../api/storageCleanup';
import type { ArchiveExecutionStore } from '../../ports/archiveExecution';
import type { RuntimeProjectWork } from '../../ports/deletion/work';

export function runtimeArchiveWork(api: ArchiveExecutionApi, store: ArchiveExecutionStore, work: RuntimeProjectWork): ArchiveExecutionApi {
  const scoped = { ...api };
  for (const name of ['ensure', 'stop', 'values', 'bind'] as const) Object.defineProperty(scoped, name, { enumerable: true, value: async (...args: unknown[]) => {
    const original = name === 'ensure' || name === 'stop' ? args[0] : await store.get(String(args[0]));
    const taskId = original && typeof original === 'object' ? Reflect.get(original, 'taskId') as unknown : undefined;
    if (typeof taskId !== 'string') throw precondition('归档回调缺少实际原任务');
    return work.runOriginResponse({ originKind: 'task', originKey: taskId, kind: 'archive', reference: newResourceId(), inputDigest: jsonHash({ method: name, args }) },
      () => Reflect.apply(api[name] as (...input: unknown[]) => Promise<unknown>, api, args));
  } });
  return scoped;
}
export function runtimeStorageWork(api: StorageCleanupApi, work: RuntimeProjectWork): StorageCleanupApi {
  const scoped = { ...api };
  for (const name of ['prepare', 'release', 'proof', 'complete'] as const) Object.defineProperty(scoped, name, { enumerable: true, value: (...args: unknown[]) => {
    const original = args[0], taskId = original && typeof original === 'object' ? Reflect.get(original, 'taskId') as unknown : undefined;
    if (typeof taskId !== 'string') return Promise.reject(precondition('存储回调缺少实际原任务'));
    return work.runOriginResponse({ originKind: 'task', originKey: taskId, kind: 'task-api', reference: newResourceId(), inputDigest: jsonHash({ method: name, args }) },
      () => Reflect.apply(api[name] as (...input: unknown[]) => Promise<unknown>, api, args));
  } });
  return scoped;
}

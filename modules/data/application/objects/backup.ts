import { precondition, validation } from '@crewstation/kernel';
import type { ObjectBackupRepository, ObjectBackupSink, StoredBackup } from '../../ports/objectBackups';
import type { ObjectBytes, ObjectCatalogRepository } from '../../ports/objectStorage';
import type { StoredObjectRecord } from '../../domain/objectStorage';

export function objectBackupOperations(deps: { backups: ObjectBackupRepository; catalog: ObjectCatalogRepository; bytes: ObjectBytes }) {
  return {
    begin: (input: { requestKey: string; destination: string; reason: string }) => {
      if (!input.requestKey.trim() || input.requestKey.length > 200 || !input.destination.trim() || input.destination.length > 120 || !input.reason.trim() || input.reason.length > 1000) throw validation('备份需要稳定请求键、目的地名称和原因');
      return deps.backups.begin(input);
    },
    status: async (id: string) => ({ record: await deps.backups.get(id), freeze: await deps.catalog.freezeStatus(id) }),
    abort: (id: string) => deps.backups.finish(id, { errorCode: 'operator_aborted' }),
    export: async (id: string, sink: ObjectBackupSink, signal: AbortSignal): Promise<StoredBackup> => {
      await deps.backups.start(id);
      try {
        const snapshot = await sink.snapshot(signal);
        if (!Number.isSafeInteger(snapshot.size) || snapshot.size <= 0 || !/^[a-f0-9]{64}$/.test(snapshot.sha256)) throw precondition('PostgreSQL 快照无效');
        let cursor: string | undefined, objectCount = 0, bytes = 0;
        while (true) {
          signal.throwIfAborted(); const page = await deps.backups.page(id, cursor);
          for (const object of page) { await copyBackupObject(deps.bytes, sink, object, signal); objectCount++; bytes += object.size; }
          await deps.backups.progress(id, objectCount, bytes);
          if (page.length < 100) break; cursor = page.at(-1)!.id;
        }
        const manifestDigest = await sink.seal({ backupId: id, snapshot, objectCount, bytes }, signal);
        return await deps.backups.finish(id, { manifestDigest, objectCount, bytes });
      } catch (error) {
        // A crashed process leaves the durable freeze active. An observed failure releases it only after recording failure.
        await deps.backups.finish(id, { errorCode: 'export_failed' }).catch(() => undefined); throw error;
      }
    },
  };
}
async function copyBackupObject(plane: ObjectBytes, sink: ObjectBackupSink, object: StoredObjectRecord, signal: AbortSignal) {
  const stream = await plane.get(object, { signal, expected: { size: object.size, sha256: object.sha256 } });
  try {
    const saved = await sink.object(object, stream.body, signal), actual = await stream.completed;
    if (saved.size !== object.size || saved.sha256 !== object.sha256 || actual.size !== object.size || actual.sha256 !== object.sha256) throw precondition('备份对象摘要不匹配');
  } catch (error) { await stream.body.cancel().catch(() => undefined); throw error; }
}

import { precondition } from '@crewstation/kernel';
import type { BackupObjectEntry, ObjectBackupRepository, VerifiedBackupBundle } from '../../ports/objectBackups';
import type { ObjectByteLocation, ObjectBytes } from '../../ports/objectStorage';

/** Runs against an isolated restored database and its restored byte plane. It never releases the write freeze. */
export async function verifyRestoredObjects(deps: { backups: ObjectBackupRepository; bytes: ObjectBytes; target?(object: BackupObjectEntry): ObjectByteLocation }, bundle: VerifiedBackupBundle, manifestDigest: string, signal: AbortSignal) {
  await deps.backups.assertRestoreTarget(bundle.manifest.backupId);
  await bundle.verify();
  const iterator = bundle.entries()[Symbol.asyncIterator]();
  let cursor: string | undefined, count = 0, bytes = 0;
  try {
    while (true) {
      const page = await deps.backups.page(bundle.manifest.backupId, cursor);
      for (const object of page) {
        signal.throwIfAborted(); const item = await iterator.next();
        if (item.done || !['id', 'spaceId', 'backendId', 'placementRevision', 'key', 'size', 'sha256'].every((field) => object[field as keyof typeof item.value] === item.value[field as keyof typeof item.value])) throw precondition('恢复的对象元数据与备份清单不一致');
        const actual = await deps.bytes.verify(deps.target?.(object) ?? object, signal, { size: object.size, sha256: object.sha256 });
        if (actual.size !== object.size || actual.sha256 !== object.sha256) throw precondition('恢复对象的实际摘要不匹配');
        count++; bytes += object.size;
      }
      if (page.length < 100) break; cursor = page.at(-1)!.id;
    }
    if (!(await iterator.next()).done || count !== bundle.manifest.objectCount || bytes !== bundle.manifest.bytes) throw precondition('恢复清单不完整');
    await deps.backups.verifyRestored(bundle.manifest.backupId, manifestDigest, count, bytes);
  } finally { await iterator.return?.(); }
}

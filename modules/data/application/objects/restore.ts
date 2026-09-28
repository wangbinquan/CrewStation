import { z } from 'zod';
import { RegisterObjectBackendSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition, validation } from '@crewstation/kernel';
import type { ObjectBackupRepository } from '../../ports/objectBackups';
import type { ObjectRestoreDestination, ObjectRestorePlane, ObjectRestoreRepository, RestorableBundle } from '../../ports/objectRestore';
import { restoredObjectLocation } from '../../domain/objectRestore';
import { verifyRestoredObjects } from './restoreVerification';

const destinationSchema = RegisterObjectBackendSchema.pick({ endpoint: true, region: true, bucket: true, accessKeyId: true, secretAccessKey: true, monitoring: true }).extend({ backendId: ResourceIdSchema });
/** The caller uses a restored, isolated PG database; the original database and source byte locations are immutable. */
export function restoreObjectOperations(deps: { backups: ObjectBackupRepository; restore: ObjectRestoreRepository; plane: ObjectRestorePlane }) {
  return async (input: { requestKey: string; destinations: readonly ObjectRestoreDestination[]; manifestDigest: string; bundle: RestorableBundle }, signal: AbortSignal): Promise<void> => {
    if (!input.requestKey.trim() || input.requestKey.length > 200 || !/^[a-f0-9]{64}$/.test(input.manifestDigest)) throw validation('恢复请求键或清单摘要无效');
    const destinations = z.array(destinationSchema).min(1).max(100).parse(input.destinations);
    if (new Set(destinations.map((d) => d.backendId)).size !== destinations.length) throw validation('恢复后端不能重复');
    const id = input.bundle.manifest.backupId, digest = jsonHash({ requestKey: input.requestKey, destinations, manifestDigest: input.manifestDigest });
    await deps.backups.assertRestoreTarget(id);
    const existing = await deps.backups.get(id);
    if (existing.restoreTarget?.activatedAt) { if (existing.restoreTarget.digest !== digest) throw precondition('此恢复已完成，不能更换目标'); return; }
    await input.bundle.verify();
    const placements = (await deps.restore.placements(id)).map((p) => { const d = destinations.find((item) => item.backendId === p.backendId); return { ...p, ...(d ? { endpoint: d.endpoint, region: d.region, bucket: d.bucket } : {}) }; });
    if (new Set(placements.map((p) => p.backendId)).size !== destinations.length || placements.some((p) => !destinations.some((d) => d.backendId === p.backendId))) throw precondition('恢复目的地必须覆盖原平台全部对象后端');
    const target = await deps.plane.prepareRestore(placements.map((p) => ({ ...destinations.find((d) => d.backendId === p.backendId)!, ...p })), signal);
    await deps.restore.prepare(id, input.requestKey, digest, placements, target.commit);
    for await (const object of input.bundle.entries()) {
      signal.throwIfAborted(); const location = restoredObjectLocation(id, object, placements);
      // Restore is a content-addressed, exact-byte replay. It never overwrites any source or user upload key.
      await target.bytes.put(location, { body: await input.bundle.content(object), size: object.size, sha256: object.sha256, signal });
      const actual = await target.bytes.verify(location, signal, object);
      if (actual.sha256 !== object.sha256 || actual.size !== object.size) throw precondition('恢复目标字节不匹配');
    }
    await verifyRestoredObjects({ backups: deps.backups, bytes: target.bytes, target: (object) => restoredObjectLocation(id, object, placements) }, input.bundle, input.manifestDigest, signal);
    await deps.restore.activate(id, digest, input.manifestDigest, input.bundle.manifest.objectCount, input.bundle.manifest.bytes);
  };
}

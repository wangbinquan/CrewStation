import { isPlatformError, newResourceId, precondition } from '@crewstation/kernel';
import type { ObjectSource } from '../domain/objectStorage';
import { storedObjectDto } from '../domain/objectStorage';
import type { ObjectContentRepository } from '../ports/objectContent';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { objectDownloadContent } from './objectTransfer';
import { trackedObjectDownload } from './objects/admittedPlane';

export interface ObjectDownloadDeps { content: ObjectContentRepository; plane: ObjectBackendPlane; owner: string }
/** Both console and service reads acquire the same durable lease after their own identity check. */
export async function downloadStoredObject(deps: ObjectDownloadDeps, id: string, source: ObjectSource, input: { signal: AbortSignal; range?: string }) {
  if (!deps.content.withRead) return originalDownload(deps,id,source,input);
  const ready = Promise.withResolvers<Awaited<ReturnType<typeof originalDownload>>>();
  const completed = deps.content.withRead(id,source,async () => {
    const result = trackedObjectDownload(await originalDownload(deps,id,source,input));
    ready.resolve({ ...result,completed });
    return result.completed;
  });
  void completed.catch(ready.reject);
  return ready.promise;
}
async function originalDownload(deps: ObjectDownloadDeps, id: string, source: ObjectSource, input: { signal: AbortSignal; range?: string }) {
  const { object, transfer } = await deps.content.acquireRead(id, newResourceId(), deps.owner, source);
  try {
    const download = await deps.plane.get(object, { ...input, expected: { size: object.size, sha256: object.sha256 } });
    return { object: storedObjectDto(object), ...download, ...objectDownloadContent(deps, object, transfer, download, input.signal) };
  } catch (error) {
    try {
      if (isPlatformError(error) && (error.kind === 'not_found' || error.details.code === 'object_length_mismatch' || error.details.code === 'object_digest_mismatch')) {
        await deps.content.markDegraded(id, '对象字节缺失或摘要不符');
        throw precondition('已登记对象的字节缺失或损坏，需从匹配摘要的备份修复', { code: 'object_content_degraded' });
      }
      throw error;
    } finally { await deps.content.releaseRead(transfer.id, transfer.owner); }
  }
}

import { isPlatformError, precondition } from '@crewstation/kernel';
import type { ObjectContentRepository } from '../ports/objectContent';
import type { ObjectBackendPlane, ObjectTransferClaim, ObjectUploadRepository } from '../ports/objectStorage';
import type { StoredObjectRecord } from '../domain/objectStorage';

export async function transferObject(deps: { uploads: ObjectUploadRepository; plane: ObjectBackendPlane }, claim: ObjectTransferClaim, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
  const abort = new AbortController(), combined = AbortSignal.any([signal, abort.signal]);
  let receivedBytes = 0;
  let heartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = deps.uploads.heartbeat(claim.attempt, receivedBytes).then((ok) => { if (!ok) abort.abort(); }).catch(() => { abort.abort(); }).finally(() => { heartbeat = undefined; });
  }, 30_000);
  try {
    const result = await deps.plane.put(claim.attempt, { body, size: claim.upload.size, sha256: claim.upload.sha256, signal: combined, onBytes: (bytes) => { receivedBytes = bytes; } });
    await deps.uploads.finish(claim.attempt, { receivedBytes: result.size, sha256: result.sha256 });
  } catch (error) {
    // A failed transport does not prove the remote PUT stopped. Keep physical budget and its writer slot.
    const code = isPlatformError(error) && typeof error.details.code === 'string' ? error.details.code : combined.aborted ? 'object_transfer_aborted' : 'object_transfer_failed';
    await deps.uploads.finish(claim.attempt, { errorCode: code, uncertain: true });
    throw error;
  } finally { clearInterval(timer); await heartbeat; }
}

/** Finish the durable read only after the bounded source has actually completed or cancelled. */
export function objectDownloadStream(deps: { content: ObjectContentRepository }, object: StoredObjectRecord, transfer: { id: string; owner: string }, download: Awaited<ReturnType<ObjectBackendPlane['get']>>, signal: AbortSignal) {
  const reader = download.body.getReader();
  const release = () => deps.content.releaseRead(transfer.id, transfer.owner);
  const failed = async (error: unknown) => {
    if (!signal.aborted && isPlatformError(error) && (error.kind === 'not_found' || error.details.code === 'object_digest_mismatch' || error.details.code === 'object_length_mismatch')) await deps.content.markDegraded(object.id, '对象字节缺失或摘要不符');
  };
  // An abandoned downstream must not hide an upstream integrity failure or retain a finished read forever.
  void download.completed.then(async (result) => {
    if (!download.contentRange && (result.size !== object.size || result.sha256 !== object.sha256)) await failed(precondition('对象读回摘要不符', { code: 'object_digest_mismatch' }));
    await release();
  }, async (error) => { try { await reader.cancel().catch(() => undefined); await failed(error); } finally { await release(); } }).catch(() => undefined);
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      try {
        const next = await reader.read();
        if (!next.done) { controller.enqueue(next.value); return; }
        const result = await download.completed;
        if (!download.contentRange && (result.size !== object.size || result.sha256 !== object.sha256)) throw precondition('对象读回摘要不符', { code: 'object_digest_mismatch' });
        await release(); controller.close(); reader.releaseLock();
      } catch (error) {
        try { await reader.cancel(error); await failed(error); } finally { await release(); controller.error(error); }
      }
    },
    cancel: async (reason) => { try { await reader.cancel(reason); } finally { await release(); } },
  }, { highWaterMark: 1 });
}

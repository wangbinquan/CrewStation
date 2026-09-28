import { isPlatformError } from '@crewstation/kernel';
import type { ObjectBackendPlane, ObjectCatalogRepository, ObjectTransferClaim, ObjectUploadRepository } from '../ports/objectStorage';

/** Observations are read-only at the backend; revisions fence a delayed probe after rotation. */
export async function probeObjectBackends(catalog: ObjectCatalogRepository, plane: ObjectBackendPlane, signal: AbortSignal): Promise<void> {
  for (const backend of await catalog.backends()) {
    if (signal.aborted) return;
    if (backend.state === 'offline') continue;
    const observed = await plane.probe(backend.id, backend.placementRevision, signal).catch(() => ({ backendId: backend.id, placementRevision: backend.placementRevision, credentialRevision: backend.credentialRevision, health: 'unavailable' as const, message: '对象后端探测不可用', observedAt: new Date().toISOString() }));
    if (!signal.aborted) await catalog.observeBackend({ freeBytes: null, totalBytes: null, ...observed });
  }
}

export async function verifyNextObject(deps: { uploads: ObjectUploadRepository; plane: ObjectBackendPlane; owner: string; heartbeatMs?: number }, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const claim = await deps.uploads.claimVerification(deps.owner);
  if (!claim) return false;
  const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
  let heartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = deps.uploads.heartbeat(claim.attempt, claim.attempt.receivedBytes).then((ok) => { if (!ok) controller.abort(); })
      .catch(() => { controller.abort(); }).finally(() => { heartbeat = undefined; });
  }, deps.heartbeatMs ?? 30_000);
  try {
    const result = await deps.plane.verify(claim.attempt, combined, { size: claim.upload.size, sha256: claim.upload.sha256 });
    combined.throwIfAborted();
    await deps.uploads.verified(claim.attempt, result);
  } catch (error) {
    const code = isPlatformError(error) && typeof error.details?.code === 'string' ? error.details.code : combined.aborted ? 'object_verification_aborted' : 'object_verification_failed';
    await failVerification(deps.uploads, claim, code);
  } finally { clearInterval(timer); await heartbeat; }
  return true;
}

async function failVerification(uploads: ObjectUploadRepository, claim: ObjectTransferClaim, code: string): Promise<void> {
  await uploads.verificationFailed(claim.attempt, code, code !== 'object_digest_mismatch' && code !== 'object_length_mismatch');
}

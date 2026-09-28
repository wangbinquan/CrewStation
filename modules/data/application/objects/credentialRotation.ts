import { RotateObjectBackendCredentialSchema } from '@crewstation/contracts';
import { forbidden, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { ObjectStorageAdminApi } from '../../api/objectStorageApi';
import type { ObjectCredentialRotations } from '../../ports/objectRotation';
import type { ObjectBackendPlane, ObjectCatalogRepository } from '../../ports/objectStorage';
import { assertSameStorageRequest, assertStorageRevision, backendDto } from '../../domain/objectStorage';

export function rotateObjectCredential(deps: { rotations?: ObjectCredentialRotations; catalog: ObjectCatalogRepository; plane: ObjectBackendPlane }): ObjectStorageAdminApi['rotateCredential'] {
  return async (actor, id, input) => {
    if (!actor.isAdmin) throw forbidden('仅平台管理员可轮换对象后端凭据');
    const request = RotateObjectBackendCredentialSchema.parse(input), digest = jsonHash({ actorId: actor.userId, request });
    if (!deps.rotations || !deps.plane.prepareRotation) throw precondition('对象凭据轮换能力尚未就绪');
    const previous = await deps.rotations.get(id, request.requestKey);
    if (previous) { assertSameStorageRequest(previous.digest, digest); return backendDto(previous.backend); }
    const backend = await deps.catalog.backend(id); if (!backend) throw notFound('对象后端');
    assertStorageRevision(backend.revision, request.expectedRevision);
    const prepared = await deps.plane.prepareRotation({ backendId: id, placementRevision: backend.placementRevision, credentialRevision: backend.credentialRevision,
      accessKeyId: request.accessKeyId, secretAccessKey: request.secretAccessKey, ...(request.monitoringToken ? { monitoringToken: request.monitoringToken } : {}) }, AbortSignal.timeout(15_000));
    return backendDto(await deps.rotations.commit({ backendId: id, requestKey: request.requestKey, expectedRevision: request.expectedRevision, digest, actorId: actor.userId, reason: request.reason },
      (tx) => prepared.commit(tx)));
  };
}

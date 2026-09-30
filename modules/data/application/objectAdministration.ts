import type { Actor } from '@crewstation/contracts';
import { forbidden, isPlatformError, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { ObjectStorageAdminApi } from '../api/objectStorageApi';
import type { ObjectBackendPlane, ObjectCatalogRepository, ObjectReadRepository, ObjectStorageHistory } from '../ports/objectStorage';
import type { ProjectAuthorizer, ServiceResolver } from '../ports/platform';
import { backendDto, spaceDto, storedObjectDto } from '../domain/objectStorage';
import type { ObjectBackendRecord, ObjectSpaceRecord } from '../domain/objectStorage';
import { downloadStoredObject, type ObjectDownloadDeps } from './objectDownload';
import type { ObjectCredentialRotations } from '../ports/objectRotation';
import { rotateObjectCredential } from './objects/credentialRotation';
import type { ObjectBackupRepository } from '../ports/objectBackups';

export interface ObjectAdministrationDeps { catalog: ObjectCatalogRepository; reads: ObjectReadRepository; plane: ObjectBackendPlane; authorizer: ProjectAuthorizer; backups?: ObjectBackupRepository; rotations?: ObjectCredentialRotations; history?: ObjectStorageHistory; services?: ServiceResolver; downloads?: Pick<ObjectDownloadDeps, 'content' | 'owner'> }
const admin = (actor: Actor) => { if (!actor.isAdmin) throw forbidden('仅平台管理员可管理对象后端'); };
const health = (backend: ObjectBackendRecord | undefined) => !backend ? 'unknown' as const : backend.state === 'offline' ? 'unavailable' as const
  : !backend.observedAt || !(Date.now() - Date.parse(backend.observedAt) <= 120_000) ? 'unknown' as const : backend.health;
const spaceHealth = (space: ObjectSpaceRecord, backend: ObjectBackendRecord | undefined) => health(backend) === 'ready' && space.health === 'degraded' ? 'degraded' as const : health(backend);
async function accessibleSpace(deps: ObjectAdministrationDeps, actor: Actor, id: string): Promise<ObjectSpaceRecord> {
  const space = await deps.catalog.space(id);
  if (!space) throw notFound('对象空间');
  try { await deps.authorizer.authorize(actor, space.projectId, 'view'); } catch (error) { if (isPlatformError(error) && error.kind === 'forbidden') throw notFound('对象空间'); throw error; }
  return space;
}

export function objectAdministration(deps: ObjectAdministrationDeps): ObjectStorageAdminApi {
  return {
    applyResourceChange: async (actor, projectId, input) => { admin(actor); await deps.authorizer.authorize(actor, projectId, 'approve-data-access'); return deps.catalog.applyResourceChange({ projectId, ...input }); },
    resourceChangeReceipt: (projectId, operationId) => deps.catalog.resourceChangeReceipt(projectId, operationId),
    rotateCredential: rotateObjectCredential(deps),
    archiveHistory: async (actor, target, query) => {
      const { spaces } = await observationScope(deps, actor, target);
      return deps.reads.archiveHistory(spaces.map((space) => space.id), query.limit, query.cursor);
    },
    receiptItems: async (actor, id, query) => {
      const page = await deps.reads.receiptPage(id, query.offset, query.limit);
      if (!page) throw notFound('归档收据');
      await accessibleSpace(deps, actor, page.spaceId);
      const { spaceId: _spaceId, ...value } = page; return value;
    },
    backends: async (actor) => { admin(actor); return (await deps.catalog.backends()).map((record) => {
      const dto = backendDto(record);
      const physicalStale = !record.physicalObservedAt || Date.now() - Date.parse(record.physicalObservedAt) > 120_000;
      return { ...dto, health: health(record), physicalFreeBytes: physicalStale ? null : record.physicalFreeBytes, physicalTotalBytes: physicalStale ? null : record.physicalTotalBytes };
    }); },
    registerBackend: async (actor, input) => {
      admin(actor);
      const record = await deps.catalog.registerBackend({
        id: newResourceId(), name: input.name, endpoint: input.endpoint, region: input.region, bucket: input.bucket, revision: 1,
        placementRevision: 1, credentialRevision: 1, state: 'active', health: 'unknown', durability: input.durability, durabilityVerifiedAt: null,
        budgetBytes: input.budgetBytes, reservedBytes: 0, activeTransfers: 0, physicalFreeBytes: null, physicalTotalBytes: null, observedAt: null,
        message: '等待对象后端探测', createdAt: new Date().toISOString(), requestKey: input.requestKey, requestDigest: jsonHash(input),
      });
      // Registration only owns the original credentials. Replaying it must never undo a later rotation.
      if (record.placementRevision === 1 && record.credentialRevision === 1) await deps.plane.configure(record.id, 1, 1, input);
      const observed = await deps.plane.probe(record.id, record.placementRevision, new AbortController().signal);
      await deps.catalog.observeBackend({ freeBytes: record.physicalFreeBytes, totalBytes: record.physicalTotalBytes, ...observed });
      return backendDto((await deps.catalog.backend(record.id))!);
    },
    updateBackend: async (actor, id, input) => { admin(actor); return backendDto(await deps.catalog.updateBackend(id, input)); },
    plans: async (actor, projectId) => {
      if (!projectId) admin(actor); else await deps.authorizer.authorize(actor, projectId, 'view');
      const authorized = projectId ? (await deps.catalog.policy(projectId)).planIds : undefined;
      return (await deps.catalog.plans()).filter((p) => !authorized || authorized.includes(p.id)).map(({ createdAt: _created, ...p }) => p);
    },
    savePlan: async (actor, id, input, expectedRevision) => {
      admin(actor); const { createdAt: _created, ...plan } = await deps.catalog.savePlan(id ?? newResourceId(), input, expectedRevision); return plan;
    },
    projectPolicy: async (actor, projectId) => { admin(actor); await deps.authorizer.authorize(actor, projectId, 'view'); return deps.catalog.policy(projectId); },
    authorizePlans: async (actor, input) => { admin(actor); await deps.authorizer.authorize(actor, input.projectId, 'view'); return deps.catalog.authorizePlans(input.projectId, input.expectedRevision, input.planIds); },
    spaces: async (actor, projectId) => {
      if (projectId) await deps.authorizer.authorize(actor, projectId, 'view'); else admin(actor);
      const backends = new Map((await deps.catalog.backends()).map((backend) => [backend.id, backend]));
      return Promise.all((await deps.catalog.spaces(projectId)).map(async (space) => ({ ...spaceDto(space), health: spaceHealth(space, backends.get(space.backendId)), serviceSlug: (await deps.services?.resolveServiceById(space.serviceId))?.slug ?? null })));
    },
    objects: async (actor, spaceId, query) => {
      await accessibleSpace(deps, actor, spaceId); const page = await deps.reads.page(spaceId, query.cursor, query.limit);
      return { items: page.items.map(storedObjectDto), nextCursor: page.nextCursor };
    },
    object: async (actor, id) => {
      const object = await deps.reads.object(id); if (!object) throw notFound('对象');
      await accessibleSpace(deps, actor, object.spaceId); return storedObjectDto(object);
    },
    download: async (actor, id, input) => {
      const object = await deps.reads.object(id); if (!object) throw notFound('对象');
      const space = await accessibleSpace(deps, actor, object.spaceId);
      if (!deps.downloads) throw precondition('对象传输能力尚未就绪');
      return downloadStoredObject({ ...deps.downloads, plane: deps.plane }, id, { projectId: space.projectId, serviceId: space.serviceId, env: space.env, fenced: false }, input);
    },
    observation: (actor, target, window) => observe(deps, actor, target, window),
    blockers: async (actor, target, query) => {
      const { spaces } = await observationScope(deps, actor, target);
      return deps.reads.blockers(spaces.map((space) => space.id), query.limit, query.cursor);
    },
  };
}

async function observationScope(deps: ObjectAdministrationDeps, actor: Actor, target: Parameters<ObjectStorageAdminApi['observation']>[1]) {
  const space = 'spaceId' in target ? await accessibleSpace(deps, actor, target.spaceId) : undefined;
  if (!space) admin(actor);
  const backend = await deps.catalog.backend(space?.backendId ?? ('backendId' in target ? target.backendId : ''));
  if (!backend) throw notFound('对象后端');
  const spaces = space ? [space] : (await deps.catalog.spaces()).filter((s) => s.backendId === backend.id);
  return { space, spaces, backend };
}

async function observe(deps: ObjectAdministrationDeps, actor: Actor, target: Parameters<ObjectStorageAdminApi['observation']>[1], window: Parameters<ObjectStorageAdminApi['observation']>[2]) {
  const { space, spaces, backend } = await observationScope(deps, actor, target), ids = spaces.map((s) => s.id);
  const [queue, blockers, history, backup] = await Promise.all([
    deps.reads.queue(ids), deps.reads.blockers(ids, 100),
    deps.history?.read({ backendId: backend.id, ...(space ? { spaceId: space.id } : {}), window }).catch(() => undefined),
    deps.backups?.observe(backend.id),
  ]);
  const aggregate = (key: 'usedBytes' | 'reservedBytes' | 'deletingBytes' | 'quotaBytes') => spaces.reduce((n, s) => n + s[key], 0);
  const physicalStale = !backend.physicalObservedAt || Date.now() - Date.parse(backend.physicalObservedAt) > 120_000;
  return {
    backendId: backend.id, spaceId: space?.id ?? null, health: space ? spaceHealth(space, backend) : health(backend), window,
    observedAt: history?.observedAt ?? null, stale: history?.stale ?? true, unavailableReason: history?.unavailableReason ?? (history ? null : '对象传输指标尚不可用'),
    logical: { usedBytes: aggregate('usedBytes'), reservedBytes: aggregate('reservedBytes'), deletingBytes: aggregate('deletingBytes'), quotaBytes: space ? space.quotaBytes : backend.budgetBytes },
    physical: { freeBytes: physicalStale ? null : backend.physicalFreeBytes, totalBytes: physicalStale ? null : backend.physicalTotalBytes, observedAt: backend.physicalObservedAt ?? null },
    queue, samples: history?.samples ?? [], blockers: blockers.items, blockersNextCursor: blockers.nextCursor, lastBackupAt: backup?.lastSucceededAt ?? null,
    backup: actor.isAdmin && !space ? backup ?? null : null,
  };
}

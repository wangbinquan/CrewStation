import type { Actor, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { RuntimeImageSelectionSchema } from '@crewstation/contracts';
import { conflict, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { ImageReferenceOwner, ImageReservationInput } from '../api/bindings';
import { renderInitializationSecrets } from './initializationSecrets';
import { selectRuntimeImage } from '../domain/selection';
import { imageContentDigest } from '../domain/contentDigest';
import type { RuntimeImageDeps } from './dependencies';
import { compatibilityEvidence, requireAvailable, versionAccess, versionLock } from './compatibility';

export function runtimeImageReferences(deps: RuntimeImageDeps) {
  return {
    inspectReference: async (projectId: string, owner: ImageReferenceOwner, snapshot: RuntimeImageExecutionSnapshot): Promise<boolean> => {
      const reference = await deps.uow.read.references.get(snapshot.versionId, owner.type, owner.id);
      if (reference?.projectId !== projectId || !reference.snapshot || imageContentDigest(reference.snapshot) !== imageContentDigest(snapshot)) return false;
      const version = await deps.uow.read.versions.get(snapshot.versionId), validation = await deps.uow.read.validations.get(snapshot.validationId);
      // Disablement prevents new selection; retained original executions keep their exact validated snapshot.
      return Boolean(version && version.state !== 'retired' && `${version.repository}@${version.digest}` === snapshot.image && version.digest === snapshot.digest && version.architecture === snapshot.architecture
        && validation?.state === 'passed' && validation.versionId === version.id && validation.projectId === projectId);
    },
    renderInitializationSecrets: renderInitializationSecrets(deps),
    reserveImage: async (actor: Actor, projectId: string, input: ImageReservationInput): Promise<RuntimeImageExecutionSnapshot | undefined> => {
      const selected = selectRuntimeImage(input.requestedVersionId, RuntimeImageSelectionSchema.parse(input.selection));
      if (!selected) return undefined;
      const inputDigest = imageContentDigest({ selected, target: input.target });
      // 已提交的快照不因停用／平台档位更新而漂移；重复准入仍需所属项目访问权。
      await deps.authorizer.authorize(actor, projectId, 'view');
      const prior = await deps.uow.read.references.get(selected.versionId, input.owner.type, input.owner.id);
      if (prior?.snapshot && prior.projectId === projectId) {
        if (prior.snapshotInputDigest !== inputDigest) throw conflict('同一引用不能改变镜像用途或选择来源');
        return prior.snapshot;
      }
      const { version, revision } = await versionAccess(deps, actor, projectId, selected.versionId);
      const { contractDigest, initializerSecretVersions } = await compatibilityEvidence(deps, actor, projectId, version, revision, input.target);
      return deps.uow.run(async (s) => {
        await s.lock(versionLock(version));
        const existing = await s.references.get(version.id, input.owner.type, input.owner.id);
        if (existing) {
          if (existing.projectId !== projectId || !existing.snapshot || existing.snapshotInputDigest !== inputDigest) throw conflict('引用已被其他准入请求占用');
          return existing.snapshot;
        }
        await requireAvailable(deps, actor, projectId, version.id, s);
        const passed = await s.validations.findPassed(version.id, contractDigest);
        if (!passed) throw precondition('该镜像尚未通过所选用途与档位的验证', { code: input.target.usage === 'agent' ? 'image_profile_incompatible' : 'image_usage_unvalidated', imageVersionId: version.id, usage: input.target.usage });
        const snapshot: RuntimeImageExecutionSnapshot = { versionId: version.id, image: `${version.repository}@${version.digest}`, digest: version.digest, architecture: version.architecture, validationId: passed.id, ...(initializerSecretVersions.length ? { initializerSecretVersions } : {}), initializerDigest: version.initializerDigest, initializer: revision.initializer, tools: revision.tools, selectionSource: selected.source };
        const at = deps.clock.now();
        await s.references.insert({ id: newResourceId(), versionId: version.id, projectId, ownerType: input.owner.type, ownerId: input.owner.id, state: 'reserved', createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + 3600000).toISOString(), snapshot, snapshotInputDigest: inputDigest });
        return snapshot;
      });
    },
    copyReference: async (projectId: string, versionId: string, from: ImageReferenceOwner, to: ImageReferenceOwner) => {
      const version = await deps.uow.read.versions.get(versionId);
      if (!version) throw notFound('运行镜像版本', versionId);
      await deps.uow.run(async (s) => {
        await s.lock(versionLock(version));
        const source = await s.references.get(versionId, from.type, from.id);
        if (source?.projectId !== projectId || !source.snapshot) throw precondition('恢复必须来源于本项目已有执行引用');
        const existing = await s.references.get(versionId, to.type, to.id);
        if (existing) {
          if (existing.projectId !== projectId || imageContentDigest(existing.snapshot) !== imageContentDigest(source.snapshot)) throw conflict('恢复身份已有不同镜像引用');
          return;
        }
        await s.references.insert({ ...source, id: newResourceId(), ownerType: to.type, ownerId: to.id, state: 'confirmed', expiresAt: null, createdAt: deps.clock.now().toISOString() });
      });
    },
    confirmReference: async (versionId: string, owner: ImageReferenceOwner) => {
      const version = await deps.uow.read.versions.get(versionId);
      if (!version) throw notFound('运行镜像版本', versionId);
      await deps.uow.run(async (s) => {
        await s.lock(versionLock(version));
        const ref = await s.references.get(versionId, owner.type, owner.id);
        if (!ref) throw notFound('运行镜像保留引用', owner.id);
        await s.references.update({ ...ref, state: 'confirmed', expiresAt: null });
      });
    },
    releaseReference: async (versionId: string, owner: ImageReferenceOwner) => {
      const version = await deps.uow.read.versions.get(versionId);
      if (!version) return;
      await deps.uow.run(async (s) => { await s.lock(versionLock(version)); const ref = await s.references.get(versionId, owner.type, owner.id); if (ref) await s.references.remove(ref.id); });
    },
  };
}

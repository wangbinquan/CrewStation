import { BUSINESS_EXECUTION_LIMITS, ServiceIdSchema, businessMaterialObjects } from '@crewstation/contracts';
import type { BusinessMaterialObject, ProjectId } from '@crewstation/contracts';
import { conflict, isPlatformError, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { StoredExecutionMaterial } from '../../ports/executionMaterials';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

/** RFC-040: pins outlive the last attempt that used them by the business-visible retention. */
export const MATERIAL_PIN_RETENTION_DAYS = BUSINESS_EXECUTION_LIMITS.retentionDays;

export function executionMaterialUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'createMaterial'> & { progressMaterials(): Promise<number> } {
  const source = executionSource(deps);
  // The release call is ordinary owner IO between two short journal transactions; an interrupted
  // release stays `releasing` and is repeated (data releases are idempotent per pin revision).
  const release = async (material: StoredExecutionMaterial, projectId: ProjectId, objects: BusinessMaterialObject[]) => {
    await deps.materialObjects!.release({ projectId, serviceId: ServiceIdSchema.parse(material.serviceId), materialId: material.view.materialId, objects, revision: material.pinRevision ?? 1 });
    await deps.materials.completeRelease(material);
  };
  return {
    createMaterial: async (caller, taskId, input) => {
      const context = await source(caller), parent = await deps.operations.forTask(context.serviceId, taskId);
      if (!parent) throw notFound('业务任务', taskId);
      const { requestKey, fence, ...content } = input, digest = jsonHash(content), objects = businessMaterialObjects(content);
      let prior = await deps.materials.find(context.serviceId, taskId, requestKey);
      if (prior && prior.view.digest !== digest) throw conflict('材料幂等键参数不同', { code: 'idempotency_conflict' });
      if (prior && (prior.state ?? 'ready') === 'ready') return prior.view;
      if (objects.length && !deps.materialObjects) throw precondition('未启用对象材料', { code: 'unsupported_capability', capability: 'materialObjectsVersion' });
      const authorization = { source: context.authority, ...(fence ? { fence } : {}) };
      // A released material is admitted again under its original key: finish any interrupted
      // release of the old revision first, then pin a new revision of the same immutable objects.
      if (prior?.state === 'releasing') await release(prior, parent.intent.projectId, objects);
      if (prior?.state === 'releasing' || prior?.state === 'released') prior = await deps.materials.revive(prior, authorization);
      // Journal first, owner pins second, publication last. A lost reply resumes the same material ID.
      const saved = prior ?? await deps.materials.reserve({ serviceId: context.serviceId, taskId, requestKey, state: objects.length ? 'preparing' : 'ready', objectCount: objects.length, sealed: await deps.cipher.seal(JSON.stringify(content)),
        view: { materialId: newResourceId(), digest, sizeBytes: Buffer.byteLength(JSON.stringify(content)), createdAt: deps.clock.now().toISOString() },
      }, authorization);
      if (saved.state === 'preparing') {
        await deps.materialObjects!.pin(caller, { projectId: parent.intent.projectId, serviceId: context.serviceId, materialId: saved.view.materialId, objects, revision: saved.pinRevision ?? 1, ...(fence ? { fence } : {}) });
        return (await deps.materials.publish(saved, authorization)).view;
      }
      return saved.view;
    },
    progressMaterials: async () => {
      if (!deps.materialObjects) return 0;
      let count = 0;
      for (const candidate of await deps.materials.releaseCandidates(20, MATERIAL_PIN_RETENTION_DAYS)) {
        try {
          const objects = businessMaterialObjects(JSON.parse(await deps.cipher.open(candidate.sealed)));
          if (candidate.state !== 'releasing' && candidate.objectCount == null) { await deps.materials.recordObjectCount(candidate, objects.length); if (!objects.length) continue; }
          const parent = await deps.operations.forTask(candidate.serviceId, candidate.taskId);
          const releasing = parent && (candidate.state === 'releasing' ? candidate : await deps.materials.beginRelease(candidate, MATERIAL_PIN_RETENTION_DAYS));
          if (!parent || !releasing) continue;
          await release(releasing, parent.intent.projectId, objects); count++;
        } catch (error) { deps.logger.warn('material object release pending', { materialId: candidate.view.materialId, error: isPlatformError(error) ? error.kind : 'unavailable' }); }
      }
      return count;
    },
  };
}

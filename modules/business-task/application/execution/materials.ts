import { businessMaterialObjects } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

export function executionMaterialUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'createMaterial'> {
  const source = executionSource(deps);
  return {
    createMaterial: async (caller, taskId, input) => {
      const context = await source(caller), parent = await deps.operations.forTask(context.serviceId, taskId);
      if (!parent) throw notFound('业务任务', taskId);
      const { requestKey, fence, ...content } = input, digest = jsonHash(content), objects = businessMaterialObjects(content);
      const prior = await deps.materials.find(context.serviceId, taskId, requestKey);
      if (prior && prior.view.digest !== digest) throw conflict('材料幂等键参数不同', { code: 'idempotency_conflict' });
      if (prior && prior.state !== 'preparing') return prior.view;
      if (objects.length && !deps.materialObjects) throw precondition('未启用对象材料', { code: 'unsupported_capability', capability: 'materialObjectsVersion' });
      const authorization = { source: context.authority, ...(fence ? { fence } : {}) };
      // Journal first, owner pins second, publication last. A lost reply resumes the same material ID.
      const saved = prior ?? await deps.materials.reserve({ serviceId: context.serviceId, taskId, requestKey, state: objects.length ? 'preparing' : 'ready', sealed: await deps.cipher.seal(JSON.stringify(content)),
        view: { materialId: newResourceId(), digest, sizeBytes: Buffer.byteLength(JSON.stringify(content)), createdAt: deps.clock.now().toISOString() },
      }, authorization);
      if (saved.state === 'preparing') {
        await deps.materialObjects!.pin(caller, { projectId: parent.intent.projectId, serviceId: context.serviceId, materialId: saved.view.materialId, objects, ...(fence ? { fence } : {}) });
        return (await deps.materials.publish(saved, authorization)).view;
      }
      return saved.view;
    },
  };
}

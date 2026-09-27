import { conflict, jsonHash, newResourceId, notFound } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

export function executionMaterialUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'createMaterial'> {
  const source = executionSource(deps);
  return {
    createMaterial: async (caller, taskId, input) => {
      const context = await source(caller);
      if (!await deps.operations.forTask(context.serviceId, taskId)) throw notFound('业务任务', taskId);
      const { requestKey, fence, ...content } = input, digest = jsonHash(content);
      const prior = await deps.materials.find(context.serviceId, taskId, requestKey);
      if (prior) { if (prior.view.digest !== digest) throw conflict('材料幂等键参数不同', { code: 'idempotency_conflict' }); return prior.view; }
      const saved = await deps.materials.reserve({ serviceId: context.serviceId, taskId, requestKey, sealed: await deps.cipher.seal(JSON.stringify(content)),
        view: { materialId: newResourceId(), digest, sizeBytes: Buffer.byteLength(JSON.stringify(content)), createdAt: deps.clock.now().toISOString() },
      }, { source: context.authority, ...(fence ? { fence } : {}) });
      return saved.view;
    },
  };
}

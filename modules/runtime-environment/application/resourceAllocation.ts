import type { Actor, ResourceTarget, ResourceValues } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import { imageAllocationRevision } from '../api/allocationRevision';
import { allocateImage } from '../domain/allocation';
import type { RuntimeImageDeps } from './dependencies';

export function imageResourceAllocationUseCases(deps: RuntimeImageDeps) {
  return {
    applyResourceChange: async (actor: Actor, projectId: string, input: { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }) => {
      if (!await deps.isAdmin(actor.userId)) throw forbidden('运行镜像分配仅由平台管理员调整');
      await deps.authorizer.authorize(actor, projectId, 'view'); ResourceIdSchema.parse(input.operationId);
      if (input.target.resourceType !== 'runtime-image' || !['grant', 'revoke'].includes(input.target.action) || Object.keys(input.values).length) throw validation('不支持的镜像分配变更');
      const hash = jsonHash({ projectId, input });
      return deps.uow.run(async (scope) => {
        await scope.lock(`image-policy:${projectId}`);
        const old = await scope.allocationReceipts.get(projectId, input.operationId);
        if (old) { if (old.hash !== hash) throw conflict('同一资源操作不能改变内容'); return { revision: old.revision, effect: old.effect, applied: true }; }
        const image = await scope.images.get(input.target.resourceId); if (!image) throw notFound('运行镜像');
        if (input.target.action === 'grant' && !image.enabled) throw precondition('运行镜像已停用');
        const current = await scope.projectImagePolicies.get(projectId), revision = current?.revision ?? 0;
        if (imageAllocationRevision(revision, image) !== input.expectedRevision) throw conflict('运行镜像或项目分配已变化');
        const policy = allocateImage(current?.policy ?? { mode: 'inherit', allowedImageIds: [] }, image.id, input.target.action === 'grant');
        await scope.projectImagePolicies.save({ projectId: current?.projectId ?? projectId as NonNullable<typeof current>['projectId'], revision: revision + 1, policy, updatedAt: deps.clock.now().toISOString() });
        const receipt = { revision: imageAllocationRevision(revision + 1, image), effect: '镜像可选范围已更新；现有执行保持固定版本，新发布或新执行选择经过验证的镜像版本', applied: true };
        await scope.allocationReceipts.save(projectId, input.operationId, { hash, ...receipt });
        return receipt;
      });
    },
    resourceChangeReceipt: async (projectId: string, operationId: string) => { const r = await deps.uow.read.allocationReceipts.get(projectId, operationId); return r ? { revision: r.revision, effect: r.effect, applied: r.applied } : undefined; },
  };
}

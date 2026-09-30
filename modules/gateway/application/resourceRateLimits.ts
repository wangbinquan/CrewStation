import type { Actor, ProjectId, ResourceTarget, ResourceValues, UserId } from '@crewstation/contracts';
import { ProjectRateLimitOverrideSchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import { gatewayAllocationRevision } from '../api/resourceLimits';
import type { GatewayUseCaseDeps } from './dependencies';
import { rateLimitUseCases } from './rateLimits';

function override(values: ResourceValues) {
  const expected = ['userAverage', 'userBurst', 'hostAverage', 'hostBurst', 'sourceAverage', 'sourceBurst', 'targetAverage', 'targetBurst'];
  if (Object.keys(values).length !== expected.length || Object.keys(values).some((key) => !expected.includes(key))) throw validation('限流参数不完整或包含不适用项');
  return ProjectRateLimitOverrideSchema.parse({ userDomain: { perUser: { average: values.userAverage, burst: values.userBurst }, perHost: { average: values.hostAverage, burst: values.hostBurst } }, serviceDomain: { perSource: { average: values.sourceAverage, burst: values.sourceBurst }, perTarget: { average: values.targetAverage, burst: values.targetBurst } } });
}
export function resourceRateLimitUseCases(deps: GatewayUseCaseDeps, isAdmin: (id: UserId) => Promise<boolean>) {
  const limits = rateLimitUseCases(deps);
  return {
    applyResourceChange: async (actor: Actor, projectId: ProjectId, input: { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }) => {
      if (!await isAdmin(actor.userId)) throw forbidden('限流调整仅平台管理员可执行');
      await deps.access.authorize(actor, projectId, 'view'); ResourceIdSchema.parse(input.operationId);
      if (!await deps.services.listServices().then((all) => all.some((s) => s.projectId === projectId && !s.archived))) throw notFound('在册项目');
      if (input.target.resourceType !== 'gateway-limit' || input.target.resourceId !== projectId || !['set-quota', 'set-default'].includes(input.target.action)) throw validation('不支持的限流变更');
      if (!deps.rateLimits.applyResourceChange) throw precondition('限流申请应用端口未就绪');
      const hash = jsonHash({ projectId, input }), old = await deps.rateLimits.resourceChangeReceipt?.(projectId, input.operationId);
      // The writer checks the command hash for retries; skip stale inspection after a committed, lost response.
      const [current, platform] = await Promise.all([limits.getProjectRateLimits({ ...actor, isAdmin: true }, projectId), limits.getRateLimits({ ...actor, isAdmin: true })]);
      if (!old && gatewayAllocationRevision(current, platform.revision) !== input.expectedRevision) throw conflict('项目限流或平台默认已变化');
      if (input.target.action === 'set-default' && Object.keys(input.values).length) throw validation('恢复继承不接受配额参数');
      const receipt = await deps.rateLimits.applyResourceChange({ projectId, operationId: input.operationId, hash, expectedRevision: current.revision, expectedPlatformRevision: platform.revision, override: input.target.action === 'set-default' ? null : override(input.values), actorId: actor.userId, now: deps.clock.now() });
      await limits.declareProjectRateLimits(projectId);
      return receipt;
    },
    resourceChangeReceipt: async (projectId: ProjectId, id: string) => deps.rateLimits.resourceChangeReceipt?.(projectId, id),
  };
}

import type { Actor, CapabilityDescriptionDto, ProjectId } from '@crewstation/contracts';
import { EVENT_HEADERS, IDENTITY_HEADERS, PLATFORM_ENV, PLATFORM_PATHS } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { notFound } from '@crewstation/kernel';
import type { CapabilitySettings, CapabilitySources } from '../ports/sources';

/** 业务任务 API 的约定摘要；与 business-task 模块的 serviceRoutes 一致（只读描述，不是第二份实现）。 */
const BUSINESS_TASK_API = [
  { method: 'POST', path: '/v1/business-tasks', summary: '以服务身份创建业务任务（长驻容器）' },
  { method: 'POST', path: '/v1/business-tasks/{taskId}/subtasks', summary: '提交 Agent 或命令子任务（agentProfile 须在 Manifest 登记）' },
  { method: 'GET', path: '/v1/business-tasks/{taskId}/subtasks/{subtaskId}', summary: '查询子任务状态与契约校验结果' },
  { method: 'GET', path: '/v1/business-tasks/{taskId}/subtasks/{subtaskId}/output', summary: '读取子任务输出（text/plain）' },
  { method: 'POST', path: '/v1/business-tasks/{taskId}/subtasks/{subtaskId}/messages', summary: '给交互模式的 Agent 子任务续消息' },
  { method: 'POST', path: '/v1/business-tasks/{taskId}/close', summary: '关闭任务并释放容器' },
];

export function describeCapabilitiesUseCase(sources: CapabilitySources, settings: CapabilitySettings, clock: Clock) {
  return async (actor: Actor, projectId: ProjectId): Promise<CapabilityDescriptionDto> => {
    await sources.authorize(actor, projectId, 'view');
    const svc = await sources.resolveServiceOfProject(projectId);
    if (!svc) throw notFound('项目服务', projectId);
    const [quota, plans, computeProfiles, devKeys, prodKeys, data, operations, subscriptions, forwarding] = await Promise.all([
      sources.quota(actor, projectId).catch(() => undefined),
      sources.servicePlans(),
      sources.computeProfiles(),
      sources.configKeys(actor, projectId, 'development'),
      sources.configKeys(actor, projectId, 'production'),
      sources.dataResources(actor, projectId),
      sources.operations(actor, svc.serviceId),
      sources.subscriptions(actor, projectId),
      sources.identityForwarding(projectId),
    ]);
    return {
      service: { identity: svc.identity, slug: svc.slug, namespace: svc.namespace },
      hosts: { prod: `${svc.slug}.${settings.userDomain}`, preview: `preview.${svc.slug}.${settings.userDomain}`, dev: `dev.${svc.slug}.${settings.userDomain}`, service: `${svc.name}.${settings.serviceDomain}`, platformApi: `api.${settings.serviceDomain}` },
      conventions: { identityHeaders: { ...IDENTITY_HEADERS }, env: { ...PLATFORM_ENV }, paths: { ...PLATFORM_PATHS }, eventHeaders: { ...EVENT_HEADERS } },
      identityForwarding: { source: forwarding.source, fields: forwarding.fields, headers: forwarding.headers, tokenClaims: forwarding.tokenClaims },
      ...(quota ? { quota } : {}),
      ...(plans.find((p) => p.name === settings.defaultServicePlan) ? { plan: plans.find((p) => p.name === settings.defaultServicePlan) } : {}),
      computeProfiles,
      config: { development: devKeys, production: prodKeys },
      data,
      operations,
      subscriptions,
      mcp: settings.mcp,
      businessTaskApi: BUSINESS_TASK_API,
      generatedAt: clock.now().toISOString(),
    };
  };
}

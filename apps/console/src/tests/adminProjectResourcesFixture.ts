import { ProjectServicePolicyDtoSchema } from '@crewstation/contracts';
import { computeProjectId, projectComputeFixture } from './projectComputeFixture';

export const resourcePagePath = `/admin/projects/${computeProjectId}/resources`;
export const servicePolicyPath = `/v1/projects/${computeProjectId}/service-policy`;
export const quotaPath = `/v1/projects/${computeProjectId}/quota`;
export const serviceTemplatePath = '/admin/projects/resource-templates';

export function projectResourcesFixture() {
  const compute = projectComputeFixture(), fallback = globalThis.fetch;
  const plan = { id: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', name: '服务标准', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' };
  const state = { serviceError: false, quotaError: false, conflict: false, mismatch: false, hold: undefined as Promise<void> | undefined, plans: [plan],
    service: ProjectServicePolicyDtoSchema.parse({ projectId: computeProjectId, revision: 0, policy: { mode: 'inherit', allowedPlanIds: [] }, updatedAt: null }),
    quota: { maxConcurrentTasks: 3, running: 4 } };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/v1/catalog/service-plans') return Response.json({ items: state.plans });
    if (path !== servicePolicyPath && path !== quotaPath) return fallback(input, init);
    if (state.hold) await state.hold;
    if (path === servicePolicyPath ? state.serviceError : state.quotaError) return Response.json({ error: 'unavailable', message: path === servicePolicyPath ? '服务范围暂不可读' : '配额暂不可读' }, { status: 503 });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      if (state.conflict) return Response.json({ error: 'conflict', message: '配置已变化，本次修改未保存' }, { status: 409 });
      if (path === servicePolicyPath) state.service = { ...state.service, revision: state.service.revision + 1, policy: body.policy };
      else state.quota = { ...state.quota, maxConcurrentTasks: body.maxConcurrentTasks };
    }
    return Response.json(path === servicePolicyPath ? { ...state.service, ...(state.mismatch ? { projectId: Bun.randomUUIDv7() } : {}) } : { ...state.quota, ...(state.mismatch ? { maxConcurrentTasks: 99 } : {}) });
  }) as typeof fetch;
  return { compute, state, writes, plan };
}

import { ProjectComputePolicyDtoSchema, ProjectDtoSchema } from '@crewstation/contracts';
import { ADMIN_ID, profileDetail, terminalProfile } from './computeProfileFixture';

export const computeProjectId = `prj_${'1'.repeat(32)}`;
export const computePolicyPath = `/v1/projects/${computeProjectId}/compute-policy`;
export const computePagePath = `/admin/projects/${computeProjectId}/compute`;

export function projectComputeFixture() {
  const project = ProjectDtoSchema.parse({ id: computeProjectId, serviceId: `svc_${'1'.repeat(32)}`, ownerUserId: ADMIN_ID, name: '算力示例项目', slug: 'compute-example', kind: 'DigitalWorker', namespace: 'cs-compute-example', state: 'active', createdAt: '2026-09-20T00:00:00Z' });
  const profiles = [profileDetail({ name: 'standard', isDefault: true, defaultVisible: true }), profileDetail({ name: 'private-large', defaultVisible: false }), terminalProfile()];
  const state = { admin: true, conflict: false, error: false, hold: undefined as Promise<void> | undefined,
    profiles, policy: ProjectComputePolicyDtoSchema.parse({ projectId: computeProjectId, revision: 0, policy: { mode: 'inherit', allowedProfiles: [], defaultProfile: null, devTaskProfile: null }, effectiveDefaultProfile: 'standard', effectiveDevTaskProfile: 'coding-medium', updatedAt: null }) };
  const calls: string[] = [], writes: unknown[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname; calls.push(path);
    if (path === '/v1/me') return Response.json({ id: ADMIN_ID, name: '管理员', email: 'admin@test.invalid', isAdmin: state.admin, platformRole: state.admin ? 'admin' : 'developer', memberships: [] });
    if (path === computePolicyPath) {
      if (state.hold) await state.hold;
      if (state.error) return Response.json({ error: 'unavailable', message: '授权目录离线' }, { status: 503 });
      if (init?.method === 'PUT') {
        const input = JSON.parse(String(init.body)); writes.push(input);
        if (state.conflict) return Response.json({ error: 'conflict', message: '项目算力授权已被修改，请重新读取后核对；本次修改未保存', details: { code: 'project_compute_revision_conflict' } }, { status: 409 });
        state.policy = { ...state.policy, policy: input.policy, revision: state.policy.revision + 1, effectiveDefaultProfile: input.policy.mode === 'inherit' ? 'standard' : input.policy.defaultProfile, effectiveDevTaskProfile: input.policy.devTaskProfile ?? 'coding-medium' };
      }
      return Response.json(state.policy);
    }
    if (path === `/v1/projects/${computeProjectId}`) return Response.json(project);
    if (path === '/v1/admin/compute-profiles') return Response.json({ items: state.profiles });
    if (path === '/v1/catalog/task-profiles') return Response.json({ items: [{ name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }, { name: 'coding-large', cpu: '2', memory: '4Gi', storage: '20Gi', description: '' }] });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, calls, writes };
}

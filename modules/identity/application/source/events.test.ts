import { expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { WorkloadIdentity } from '@crewstation/contracts';
import type { VerifiedToken } from '../../ports/tokenService';
import { resolveEventSource } from './events';

const projectId = ProjectIdSchema.parse('01a0bf5d-8f4b-7000-8000-000000000001'), serviceId = ServiceIdSchema.parse('01a0bf5d-8f4b-7000-8000-000000000002');
const workload: WorkloadIdentity = { identity: 'source/source', project: 'source', service: 'source', kind: 'service', slot: 'prod', pod: { uid: 'original-pod', name: 'source-blue', namespace: 'cs-source', ip: '10.1.2.3' } };
const token: VerifiedToken = { subject: 'service:source/source', audience: ['service:platform:events'], expiresAt: 1,
  claims: { [TOKEN_CLAIMS.kind]: 'service', [TOKEN_CLAIMS.project]: 'source', [TOKEN_CLAIMS.sourceProjectId]: projectId, [TOKEN_CLAIMS.sourceServiceId]: serviceId,
    [TOKEN_CLAIMS.sourceIp]: '10.1.2.3', [TOKEN_CLAIMS.sourcePodUid]: 'original-pod' } };

test('事件来源只返回固定受众、原 Pod 与原项目／服务均一致的调用者；缺失端口和所有错误身份拒绝', async () => {
  let verified: VerifiedToken | undefined = token, current: WorkloadIdentity | undefined = workload, owner: { projectId: typeof projectId; serviceId: typeof serviceId } | undefined = { projectId, serviceId }, available = true;
  const deps = {
    tokens: { verify: async (_token: string, expected: { audience: string }) => { expect(expected.audience).toBe('service:platform:events'); return verified; }, sign: async () => '', jwks: async () => ({ keys: [] }), rotate: async () => ({ kid: '' }) },
    workloads: { byIp: async (ip: string) => { expect(ip).toBe('10.1.2.3'); return current; } },
    workloadOwnership: { resolve: async () => owner }, projectAdmission: { byId: async (id: typeof projectId) => { expect(id).toBe(projectId); return available; }, bySlug: async () => { throw new Error('Names cannot authorize'); } },
  };
  const resolve = resolveEventSource(deps);
  expect(await resolve('signed')).toEqual({ identity: workload.identity, project: 'source', service: 'source', slot: 'prod', projectId, serviceId });
  for (const claims of [{ [TOKEN_CLAIMS.sourceProjectId]: 'invalid' }, { [TOKEN_CLAIMS.sourceServiceId]: undefined }, { [TOKEN_CLAIMS.sourceIp]: false }, { [TOKEN_CLAIMS.sourcePodUid]: '' }, { [TOKEN_CLAIMS.kind]: 'business-task' }, { [TOKEN_CLAIMS.project]: 'replacement' }]) {
    verified = { ...token, claims: { ...token.claims, ...claims } }; expect(await resolve('signed')).toBeUndefined();
  }
  verified = { ...token, subject: 'service:other/other' }; expect(await resolve('signed')).toBeUndefined();
  verified = undefined; expect(await resolve('invalid')).toBeUndefined(); verified = token;
  for (const value of [undefined, { ...workload, kind: 'platform' as const }, { ...workload, pod: undefined }, { ...workload, pod: { ...workload.pod!, uid: 'replacement-pod' } }]) { current = value; expect(await resolve('signed')).toBeUndefined(); }
  current = workload;
  for (const value of [undefined, { projectId: ProjectIdSchema.parse('01a0bf5d-8f4b-7000-8000-000000000003'), serviceId }, { projectId, serviceId: ServiceIdSchema.parse('01a0bf5d-8f4b-7000-8000-000000000004') }]) { owner = value; expect(await resolve('signed')).toBeUndefined(); }
  owner = { projectId, serviceId }; available = false; expect(await resolve('signed')).toBeUndefined();
  expect(await resolveEventSource({ ...deps, workloadOwnership: undefined })('signed')).toBeUndefined();
  expect(await resolveEventSource({ ...deps, projectAdmission: undefined })('signed')).toBeUndefined();
});

import { expect, test } from 'bun:test';
import type { AllowlistDocument, ProjectId, ProjectNamespaceQuotaDto, ProjectRateLimitsDto, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient } from '@crewstation/k8s';
import { projectResourceState } from './projectResourceState';

test('namespace application requires both spec and observed hard values for the same policy revision', async () => {
  const k8s = createFakeK8sClient(), id = Bun.randomUUIDv7() as ProjectId, quota = { requestsCpu: 4, requestsMemoryGiB: 8, pods: 20, persistentVolumeClaims: 10 }; let revision = 1;
  const state = projectResourceState(k8s, { actor: { userId: Bun.randomUUIDv7() as UserId, isAdmin: true }, service: async () => ({ namespace: 'cs-test', identity: 'p/p' }), namespace: async () => ({ projectId: id, revision, quota, updatedAt: null } satisfies ProjectNamespaceQuotaDto), namespaceRevision: (r) => String(r), gateway: async () => { throw new Error('unused'); }, allowlist: async () => undefined });
  const receipt = { revision: '1', effect: '', applied: false };
  expect((await state.observeNamespace(id, receipt)).applied).toBe(false);
  const hard = { 'requests.cpu': '4000m', 'requests.memory': '8Gi', pods: '20', persistentvolumeclaims: '10' }, object = { apiVersion: 'v1', kind: 'ResourceQuota', metadata: { name: 'crewstation-project', namespace: 'cs-test' }, spec: { hard }, status: { hard: { ...hard, pods: '10' } } };
  await k8s.apply(object as K8sObject); expect((await state.observeNamespace(id, receipt)).applied).toBe(false); object.status.hard.pods = '20'; await k8s.apply(object as K8sObject); expect((await state.observeNamespace(id, receipt)).applied).toBe(true);
  revision = 2; await expect(state.observeNamespace(id, receipt)).rejects.toMatchObject({ kind: 'precondition' });
});
test('gateway checks all four actual buckets and identity sources; API observation requires a current allowlist', async () => {
  const k8s = createFakeK8sClient(), id = Bun.randomUUIDv7() as ProjectId; const holder: { document?: AllowlistDocument } = {};
  const effective = { userDomain: { perUser: { average: 2, burst: 4 }, perHost: { average: 2, burst: 4 } }, serviceDomain: { perSource: { average: 2, burst: 4 }, perTarget: { average: 2, burst: 4 } } };
  const state = projectResourceState(k8s, { actor: { userId: Bun.randomUUIDv7() as UserId, isAdmin: true }, service: async () => ({ namespace: 'cs-test', identity: 'p/p' }), namespace: async () => { throw new Error('unused'); }, namespaceRevision: () => '', gateway: async () => ({ revision: 1, effective } as ProjectRateLimitsDto), allowlist: async () => holder.document });
  const receipt = { revision: '1', effect: '', applied: false }; expect((await state.observeGateway(id, receipt)).applied).toBe(false);
  const sources = { user: { requestHeaderName: IDENTITY_HEADERS.userId }, host: { requestHost: true }, source: { requestHeaderName: IDENTITY_HEADERS.sourceService }, target: { requestHost: true } };
  for (const [name, sourceCriterion] of Object.entries(sources)) await k8s.apply({ apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware', metadata: { name: `rate-limit-${name}`, namespace: 'cs-test' }, spec: { rateLimit: { average: 2, burst: 4, sourceCriterion } } } as K8sObject);
  expect((await state.observeGateway(id, receipt)).applied).toBe(true);
  await k8s.apply({ apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware', metadata: { name: 'rate-limit-user', namespace: 'cs-test' }, spec: { rateLimit: { average: 2, burst: 4, sourceCriterion: { requestHost: true } } } } as K8sObject); expect((await state.observeGateway(id, receipt)).applied).toBe(false);
  const target = { resourceType: 'api-operation' as const, resourceId: 'op', action: 'grant' as const }; expect((await state.observeApi(id, target)).applied).toBe(false);
  holder.document = { entries: [{ caller: 'other/other', operations: ['op'] }], defaultOpen: [] } as unknown as AllowlistDocument; expect((await state.observeApi(id, target)).applied).toBe(false);
  holder.document!.entries = [{ caller: 'p/p', operations: ['op'], platformApi: false, platformHosts: [] }]; expect((await state.observeApi(id, target)).applied).toBe(true); expect((await state.observeApi(id, { ...target, action: 'revoke' })).applied).toBe(false);
  holder.document!.entries = []; expect((await state.observeApi(id, { ...target, action: 'revoke' })).applied).toBe(true);
});

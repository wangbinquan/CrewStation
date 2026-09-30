import { expect, test } from 'bun:test';
import type { Actor, ProjectId, ResourceTargetDescription, UserId } from '@crewstation/contracts';
import type { ResourceCatalogPorts, ResourceCommand } from '../../ports/resourceCatalogs';
import { resourceCatalogs } from './resourceCatalogs';
import { pagedCatalog, confirming } from './catalog';

const projectId = Bun.randomUUIDv7() as ProjectId, actor: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: true }, receipt = { revision: 'saved', effect: 'Saved', applied: false }, GIB = 1024 ** 3;
function fixture() {
  const state = { restricted: false, excluded: false, enabled: true, apiPending: false, override: true }, writes: ResourceCommand[] = [];
  const apply = async (...args: unknown[]) => { writes.push(args.at(-1) as ResourceCommand); return receipt; }, recover = async () => receipt;
  const production: ResourceTargetDescription = { target: { resourceType: 'production-data', resourceId: 'workspace', action: 'production-access' }, revision: 'r1', name: 'Production access', current: {}, fields: [], impact: [], owned: false, available: true };
  const effective = { userDomain: { perUser: { average: 2, burst: 4 }, perHost: { average: 3, burst: 6 } }, serviceDomain: { perSource: { average: 4, burst: 8 }, perTarget: { average: 5, burst: 10 } } };
  const ports = { actor, project: {
    listServicePlans: async () => [{ id: 'service', name: 'Service', cpu: '1', memory: '1Gi', maxReplicas: 2, description: 'Service purpose' }], listTaskProfiles: async () => [{ id: 'task', name: 'Task', cpu: '1', memory: '1Gi', storage: '2Gi', description: 'Task purpose' }],
    getServicePolicy: async () => ({ revision: 1, policy: { mode: state.restricted ? 'restricted' : 'inherit', allowedPlanIds: state.restricted ? ['service'] : [], additionalPlanIds: ['service'], excludedPlanIds: state.excluded ? ['service'] : [] } }), getQuota: async () => ({ maxConcurrentTasks: 3, running: 2 }), getNamespaceQuota: async () => ({ revision: 1, quota: { requestsCpu: 4, requestsMemoryGiB: 8, pods: 20, persistentVolumeClaims: 10 } }),
    applyResourceChange: apply, resourceChangeReceipt: recover, resolveServiceOfProject: async () => ({ serviceId: 'service-id', namespace: 'cs-test', identity: 'p/p' }) },
    compute: { listProfiles: async () => ({ items: [{ id: 'agent', name: 'Agent', description: 'Compute purpose', protocol: 'opencode', enabled: state.enabled, defaultVisible: true, revision: 1 }, { id: 'terminal', name: 'Terminal', protocol: 'terminal', enabled: true, defaultVisible: false, revision: 1 }] }), getProjectComputePolicy: async () => ({ revision: 1, effectiveDefaultProfile: 'agent', effectiveDevTaskProfile: 'task', policy: { mode: state.restricted ? 'restricted' : 'inherit', allowedProfiles: state.restricted ? ['agent'] : [], additionalProfiles: ['terminal'], excludedProfiles: state.excluded ? ['agent'] : [] } }), applyResourceChange: apply, resourceChangeReceipt: recover },
    images: { adminCatalog: async () => [{ id: 'image', name: 'Image', description: 'Tools', enabled: state.enabled, revision: 1 }], listImages: async () => state.excluded ? [] : [{ id: 'image' }], getProjectImagePolicy: async () => ({ revision: 1, policy: { mode: state.restricted ? 'restricted' : 'inherit', additionalImageIds: [] } }), applyResourceChange: apply, resourceChangeReceipt: recover },
    objects: { plans: async () => [{ id: 'objects', name: 'Objects', enabled: state.enabled, quotaBytes: GIB * 4, maxObjectBytes: GIB, maxConcurrentTransfers: 2 }], projectPolicy: async () => ({ revision: 1, planIds: ['objects'] }), spaces: async () => [{ id: 'space', projectId, env: 'production', quotaBytes: GIB * 4, usedBytes: GIB, reservedBytes: GIB / 4, deletingBytes: GIB / 4, objectCount: 3, maxObjectBytes: GIB, maxConcurrentTransfers: 2, quotaSource: 'project', health: 'ready' }], applyResourceChange: apply, resourceChangeReceipt: recover },
    api: { listRequests: async () => state.apiPending ? [{ operationId: 'api', state: 'pending' }] : [], listOperations: async () => [{ id: 'api', method: 'GET', path: '/api', openPolicy: 'targeted', granted: false }, { id: 'default', method: 'GET', path: '/default', openPolicy: 'default', granted: true }], applyResourceChange: apply, resourceChangeReceipt: recover },
    gateway: { getRateLimits: async () => ({ revision: 1 }), getProjectRateLimits: async () => ({ revision: 1, override: state.override ? effective : null, effective }), applyResourceChange: apply, resourceChangeReceipt: recover },
    production: { listProductionAccessTargets: async () => [production], inspectProductionAccess: async () => production, applyProductionAccess: apply, productionAccessReceipt: recover, observeProductionAccess: async () => receipt },
    revisions: { service: () => 'r1', namespace: () => 'r1', execution: () => 'r1', compute: () => 'r1', task: () => 'r1', image: () => 'r1', objectPlan: () => 'r1', objectSpace: () => 'r1', api: () => 'r1', gateway: () => 'r1', gatewayValues: () => ({ userAverage: 2, userBurst: 4, hostAverage: 3, hostBurst: 6, sourceAverage: 4, sourceBurst: 8, targetAverage: 5, targetBurst: 10 }) },
    reapplyNamespace: async () => { writes.push('namespace-reapply' as unknown as ResourceCommand); }, observeNamespace: async () => receipt, observeGateway: async () => receipt, observeApi: async () => receipt } as unknown as ResourceCatalogPorts;
  return { ports, state, writes };
}
test('all eleven types expose scoped metadata, quotas and explicit management commands', async () => {
  const f = fixture(), adapters = resourceCatalogs(f.ports); expect(new Set(adapters.map((a) => a.resourceType)).size).toBe(11);
  for (const adapter of adapters) {
    const views = await adapter.list(projectId); expect(views.length).toBeGreaterThan(0); const view = views[0]!;
    expect(await adapter.read(projectId, view.target)).toEqual(view); await expect(adapter.read(projectId, { ...view.target, resourceId: 'not-present' })).rejects.toMatchObject({ kind: 'not_found' });
    const command: ResourceCommand = { actor, projectId, operationId: Bun.randomUUIDv7(), target: view.target, expectedRevision: view.revision, values: {}, requestedBy: actor.userId, reason: 'Administrator change' };
    expect(await adapter.apply(command)).toEqual(receipt); expect(await adapter.recover?.(projectId, command.operationId)).toEqual(receipt); if (adapter.observe) expect(await adapter.observe(projectId, view.target, receipt, command.operationId)).toEqual(receipt);
  }
  const space = (await adapters.find((a) => a.resourceType === 'object-space')!.list(projectId))[0]!; expect(space.metrics?.map((m) => m.key)).toEqual(['quotaGiB', 'maxObjectGiB', 'maxConcurrentTransfers']); expect(space.metrics?.[0]).toMatchObject({ limit: 4, used: 1, reserved: 0.5 });
  const api = await adapters.find((a) => a.resourceType === 'api-operation')!.list(projectId); expect(api.filter((v) => v.target.resourceId === 'default')).toHaveLength(1); expect(api.find((v) => v.target.resourceId === 'default')?.available).toBe(false);
  expect(f.writes.some((w) => w === 'namespace-reapply' as unknown)).toBe(true); expect(f.writes.find((w) => w.operationId)?.expectedRevision).toBe('r1');
});
test('inheritance, exclusions, disabled resources and pending legacy requests keep their own meaning', async () => {
  const f = fixture(), byType = new Map(resourceCatalogs(f.ports).map((a) => [a.resourceType, a]));
  const inherited = await byType.get('compute-profile')!.list(projectId); expect(inherited.find((v) => v.target.resourceId === 'agent')?.source).toBe('inherited'); expect(inherited.filter((v) => v.target.resourceId === 'terminal')).toHaveLength(2);
  f.state.restricted = true; f.state.enabled = false; const disabled = await byType.get('compute-profile')!.list(projectId); expect(disabled.find((v) => v.target.action === 'grant')?.available).toBe(false); expect(disabled.find((v) => v.target.action === 'revoke')?.available).toBe(true);
  f.state.excluded = true; f.state.apiPending = true; f.state.override = false;
  expect((await byType.get('service-plan')!.list(projectId))[0]?.owned).toBe(false); expect((await byType.get('compute-profile')!.list(projectId)).some((v) => v.target.resourceId === 'agent' && v.target.action === 'set-default')).toBe(false);
  expect((await byType.get('runtime-image')!.list(projectId))[0]?.owned).toBe(false); expect((await byType.get('api-operation')!.list(projectId)).find((v) => v.target.resourceId === 'api')?.available).toBe(false); expect(await byType.get('gateway-limit')!.list(projectId)).toHaveLength(1);
  f.ports.objects = undefined; const withoutObjects = new Map(resourceCatalogs(f.ports).map((a) => [a.resourceType, a])); expect(await withoutObjects.get('object-plan')!.list(projectId)).toEqual([]); expect(await withoutObjects.get('object-space')!.list(projectId)).toEqual([]);
});
test('catalog pagination is bounded and recovery schedules projection only for committed pending receipts', async () => {
  const pages: Array<{ limit: number; before?: string }> = [];
  expect(await pagedCatalog(async (page) => { pages.push(page); return page.before ? [{ id: 'last' }] : Array.from({ length: 100 }, (_, i) => ({ id: String(i) })); })).toHaveLength(101); expect(pages[1]?.before).toBe('99');
  await expect(pagedCatalog(async () => Array.from({ length: 100 }, () => ({ id: 'same' })))).rejects.toMatchObject({ kind: 'precondition' });
  let calls = 0; expect(await confirming(async () => receipt, async () => { calls++; })(projectId, 'operation')).toEqual(receipt); expect(calls).toBe(1);
  await confirming(async () => ({ ...receipt, applied: true }), async () => { calls++; })(projectId, 'operation'); expect(calls).toBe(1);
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newResourceId } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { createProjectModule, projectMigrations, type ProjectModule } from '../wiring';
import { executionQuotaRevision, namespaceQuotaRevision, serviceAllocationRevision } from '../api/resourceRevisions';

const available = await testDatabaseAvailable(); let db: TestDatabase, mod: ProjectModule, admin: Actor, owner: Actor, id: ProjectId;
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'resources-admin', name: 'Admin', email: 'admin@test.cn' }), o = await identity.api.ensureUser({ externalId: 'resources-owner', name: 'Owner', email: 'owner@test.cn' });
  if (a.platformRole !== 'admin') await identity.api.setPlatformRole(a.id, { expectedRole: a.platformRole, platformRole: 'admin' }); if (o.platformRole !== 'developer') await identity.api.setPlatformRole(o.id, { expectedRole: o.platformRole, platformRole: 'developer' });
  admin = { userId: a.id, isAdmin: true }; owner = { userId: o.id, isAdmin: false };
  mod = createProjectModule({ db: db.db, identity: identity.api, hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` }, taskUsage: { runningTasks: async () => 2 }, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall } });
  id = (await mod.api.createProject(admin, { slug: 'resources', name: 'Resources', template: BUILTIN_RESOURCES.minimalTemplate, kind: 'DigitalWorker', ownerUserId: owner.userId })).id;
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('project resource policy commands', () => {
  test('fresh administrator, versioned quota, durable lost-response receipt and actual namespace intent', async () => {
    const quota = await mod.api.getQuota(owner, id), command = { operationId: newResourceId(), target: { resourceType: 'execution-quota' as const, resourceId: id, action: 'set-quota' as const }, expectedRevision: executionQuotaRevision(quota.maxConcurrentTasks), values: { maxConcurrentTasks: 1 } };
    await expect(mod.api.applyResourceChange({ ...owner, isAdmin: true }, id, command)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(mod.api.applyResourceChange(admin, id, { ...command, target: { ...command.target, resourceId: newResourceId() } })).rejects.toMatchObject({ kind: 'validation' });
    const receipt = await mod.api.applyResourceChange(admin, id, command); expect(receipt.applied).toBe(true);
    expect(await mod.api.getQuota(owner, id)).toMatchObject({ maxConcurrentTasks: 1, running: 2 });
    expect(await mod.api.applyResourceChange(admin, id, command)).toEqual(receipt);
    expect(await mod.api.resourceChangeReceipt(id, command.operationId)).toEqual(receipt);
    await expect(mod.api.applyResourceChange(admin, id, { ...command, values: { maxConcurrentTasks: 8 } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(mod.api.applyResourceChange(admin, id, { ...command, operationId: newResourceId() })).rejects.toMatchObject({ kind: 'conflict' });
    const namespace = await mod.api.getNamespaceQuota(owner, id), next = { ...namespace.quota, requestsCpu: 12.5, pods: 60 };
    expect((await mod.api.applyResourceChange(admin, id, { operationId: newResourceId(), target: { resourceType: 'namespace-quota', resourceId: id, action: 'set-quota' }, expectedRevision: namespaceQuotaRevision(namespace.revision, namespace.quota), values: next })).applied).toBe(false);
    expect(await mod.api.namespaceQuota(id)).toEqual(next);
    await expect(mod.api.applyResourceChange(admin, id, { operationId: newResourceId(), target: { resourceType: 'namespace-quota', resourceId: id, action: 'set-quota' }, expectedRevision: namespaceQuotaRevision(namespace.revision, namespace.quota), values: { ...next, pods: -1 } })).rejects.toBeDefined();
  });
  test('grant and revoke preserve inheritance; restricted empty policy stays closed; concurrent stale commands cannot both commit', async () => {
    const plan = await mod.api.createServicePlan(admin, { name: 'Resources large', cpu: '2', memory: '4Gi', maxReplicas: 4, description: '' });
    const command = (revision: number, action: 'grant' | 'revoke') => ({ operationId: newResourceId(), target: { resourceType: 'service-plan' as const, resourceId: plan.id, action }, expectedRevision: serviceAllocationRevision(revision, plan), values: {} });
    await mod.api.applyResourceChange(admin, id, command(0, 'revoke'));
    expect((await mod.api.getServicePolicy(owner, id)).policy).toMatchObject({ mode: 'inherit', excludedPlanIds: [plan.id] });
    expect((await mod.api.listProjectServicePlans(owner, id)).some((p) => p.id === plan.id)).toBe(false);
    const results = await Promise.allSettled([mod.api.applyResourceChange(admin, id, command(1, 'grant')), mod.api.applyResourceChange(admin, id, command(1, 'grant'))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await mod.api.getServicePolicy(owner, id)).policy).toMatchObject({ mode: 'inherit', additionalPlanIds: [plan.id], excludedPlanIds: [] });
    await mod.api.saveServicePolicy(admin, id, { expectedRevision: 2, policy: { mode: 'restricted', allowedPlanIds: [] } });
    expect(await mod.api.listProjectServicePlans(owner, id)).toEqual([]);
    await mod.api.applyResourceChange(admin, id, command(3, 'grant')); expect((await mod.api.listProjectServicePlans(owner, id)).map((p) => p.id)).toEqual([plan.id]);
  });
});

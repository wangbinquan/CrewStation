import { and, eq } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { conflict, forbidden, jsonHash, notFound, precondition, quotaExceeded } from '@crewstation/kernel';
import type { ObjectBackendRecord, ObjectPlanRecord, ObjectSpaceRecord } from '../../domain/objectStorage';
import { assertSameStorageRequest, assertStorageRevision } from '../../domain/objectStorage';
import type { ObjectCatalogRepository, ObjectProjectPolicy } from '../../ports/objectStorage';
import { objectBackends, objectPlans, objectProjectPolicies, objectSpaces, objectStorageFreezes, objectWriteControls, storedObjects } from './objectTables';
import { objectFreezeStatus } from './objectFreeze';
import { assertStorageContractEnabled } from './objects/contractState';
import { objectResourceAllocations } from './objectResourceAllocations';

import { assertObjectStorageUnfrozen, objectStorageTransaction, requireObjectBackend, saveObjectBackend, saveObjectSpace } from './objectMetadata';
export { assertObjectStorageUnfrozen, authorizeObjectWrite, objectStorageTransaction, requireObjectBackend, requireObjectSpace, saveObjectBackend, saveObjectSpace } from './objectMetadata';

async function declaredQuota(db: Executor, backendId: string, except?: string): Promise<number> {
  return (await db.select().from(objectSpaces).where(eq(objectSpaces.backendId, backendId)))
    .reduce((sum, row) => sum + (row.id === except ? 0 : row.body.quotaBytes), 0);
}
async function synchronizeSpaceHealth(db: Executor, backend: ObjectBackendRecord): Promise<void> {
  for (const row of await db.select().from(objectSpaces).where(eq(objectSpaces.backendId, backend.id))) {
    const degraded = (await db.select({ id: storedObjects.id }).from(storedObjects).where(and(eq(storedObjects.spaceId, row.id), eq(storedObjects.state, 'degraded'))).limit(1)).length > 0;
    await saveObjectSpace(db, { ...row.body, health: backend.state === 'offline' ? 'unavailable' : backend.health === 'ready' && degraded ? 'degraded' : backend.health });
  }
}
async function policyOf(db: Executor, projectId: ObjectProjectPolicy['projectId']): Promise<ObjectProjectPolicy> {
  return (await db.select().from(objectProjectPolicies).where(eq(objectProjectPolicies.projectId, projectId)))[0]?.body ?? { projectId, revision: 1, planIds: [] };
}

export function objectCatalogRepository(db: Database, options: { requireContract?: boolean } = {}): ObjectCatalogRepository {
  return {
    registerBackend: (record) => objectStorageTransaction(db, async (tx) => {
      const existing = (await tx.select().from(objectBackends).where(eq(objectBackends.requestKey, record.requestKey)))[0]?.body;
      if (existing) { assertSameStorageRequest(existing.requestDigest, record.requestDigest); return existing; }
      await tx.insert(objectBackends).values({ id: record.id, requestKey: record.requestKey, body: record });
      return record;
    }),
    backend: async (id) => (await db.select().from(objectBackends).where(eq(objectBackends.id, id)))[0]?.body,
    backends: async () => (await db.select().from(objectBackends).orderBy(objectBackends.id)).map((row) => row.body),
    updateBackend: (id, input) => objectStorageTransaction(db, async (tx) => {
      const record = await requireObjectBackend(tx, id);
      assertStorageRevision(record.revision, input.expectedRevision);
      await assertObjectStorageUnfrozen(tx, id);
      if (input.budgetBytes < Math.max(record.reservedBytes, await declaredQuota(tx, id))) throw precondition('后端预算不能低于已分配空间及未释放物理预留', { code: 'object_budget_in_use' });
      const next = { ...record, name: input.name, budgetBytes: input.budgetBytes, state: input.state, revision: record.revision + 1 };
      await saveObjectBackend(tx, next); await synchronizeSpaceHealth(tx, next);
      return next;
    }),
    observeBackend: (input) => objectStorageTransaction(db, async (tx) => {
      const record = await requireObjectBackend(tx, input.backendId);
      if (record.placementRevision !== input.placementRevision || record.credentialRevision !== input.credentialRevision || (record.observedAt && record.observedAt >= input.observedAt)) return false;
      const physical = input.physicalObservedAt === undefined ? {} : { physicalFreeBytes: input.freeBytes, physicalTotalBytes: input.totalBytes, physicalObservedAt: input.physicalObservedAt };
      const next = { ...record, ...physical, health: input.health, observedAt: input.observedAt, message: input.message };
      await saveObjectBackend(tx, next); await synchronizeSpaceHealth(tx, next);
      return true;
    }),
    ...planAndSpaceOperations(db, options),
    ...controlOperations(db),
    ...objectResourceAllocations(db),
  };
}

function planAndSpaceOperations(db: Database, options: { requireContract?: boolean }): Pick<ObjectCatalogRepository, 'savePlan' | 'plans' | 'policy' | 'authorizePlans' | 'ensureSpace' | 'space' | 'spaces' | 'serviceSpace'> {
  return {
    savePlan: (id, input, expectedRevision) => objectStorageTransaction(db, async (tx, now) => {
      const backend = await requireObjectBackend(tx, input.backendId);
      await assertObjectStorageUnfrozen(tx, backend.id);
      const previous = (await tx.select().from(objectPlans).where(eq(objectPlans.id, id)))[0]?.body;
      if (previous) {
        assertStorageRevision(previous.revision, expectedRevision ?? 0);
        if (previous.backendId !== input.backendId) throw precondition('档位不能直接改换对象后端', { code: 'object_backend_migration_required' });
      } else if (expectedRevision !== undefined) throw notFound('对象存储档位', id);
      if (input.quotaBytes > backend.budgetBytes) throw precondition('档位容量超过后端预算');
      const plan: ObjectPlanRecord = { ...input, id, revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now.toISOString() };
      await tx.insert(objectPlans).values({ id, backendId: input.backendId, body: plan }).onConflictDoUpdate({ target: objectPlans.id, set: { body: plan } });
      return plan;
    }),
    plans: async () => (await db.select().from(objectPlans).orderBy(objectPlans.id)).map((row) => row.body),
    policy: (projectId) => policyOf(db, projectId),
    authorizePlans: (projectId, expectedRevision, planIds) => objectStorageTransaction(db, async (tx) => {
      const original = await policyOf(tx, projectId);
      assertStorageRevision(original.revision, expectedRevision);
      for (const id of planIds) if (!(await tx.select().from(objectPlans).where(eq(objectPlans.id, id)))[0]?.body.enabled) throw precondition('只能授权已启用的对象档位');
      const policy = { projectId, revision: original.revision + 1, planIds: [...new Set(planIds)] };
      await tx.insert(objectProjectPolicies).values({ projectId, body: policy }).onConflictDoUpdate({ target: objectProjectPolicies.projectId, set: { body: policy } });
      return policy;
    }),
    ensureSpace: (input) => objectStorageTransaction(db, async (tx, now) => { if (options.requireContract) await assertStorageContractEnabled(tx); return ensureSpace(tx, input, now); }),
    space: async (id) => (await db.select().from(objectSpaces).where(eq(objectSpaces.id, id)))[0]?.body,
    spaces: async (projectId) => (await db.select().from(objectSpaces).where(projectId ? eq(objectSpaces.projectId, projectId) : undefined).orderBy(objectSpaces.id)).map((row) => row.body),
    serviceSpace: async (serviceId, env) => (await db.select().from(objectSpaces).where(and(eq(objectSpaces.serviceId, serviceId), eq(objectSpaces.env, env))))[0]?.body,
  };
}

async function ensureSpace(tx: Transaction, input: Parameters<ObjectCatalogRepository['ensureSpace']>[0], now: Date): Promise<ObjectSpaceRecord> {
  const policy = await policyOf(tx, input.projectId);
  if (!policy.planIds.includes(input.planId)) throw forbidden('项目未获对象存储档位授权');
  const plan = (await tx.select().from(objectPlans).where(eq(objectPlans.id, input.planId)))[0]?.body;
  if (!plan?.enabled) throw precondition('对象存储档位不可用');
  const backend = await requireObjectBackend(tx, plan.backendId);
  await assertObjectStorageUnfrozen(tx, backend.id);
  if (backend.state !== 'active' || backend.health !== 'ready') throw precondition('对象存储后端尚未就绪');
  if (input.deploymentMode === 'production' && (backend.durability !== 'replicated' || !backend.durabilityVerifiedAt)) throw precondition('生产环境必须使用经过验证的冗余后端', { code: 'object_durability_unverified' });
  const previous = (await tx.select().from(objectSpaces).where(and(eq(objectSpaces.serviceId, input.serviceId), eq(objectSpaces.env, input.env))))[0]?.body;
  if (previous && (previous.projectId !== input.projectId || previous.backendId !== backend.id || previous.backendPlacementRevision !== backend.placementRevision)) throw precondition('已有对象空间需要显式迁移，不能换后端或归属');
  const quotaBytes = previous?.quotaOverrides?.quotaBytes ?? plan.quotaBytes;
  if (previous && quotaBytes < previous.usedBytes + previous.reservedBytes + previous.deletingBytes) throw precondition('空间新配额低于已使用和预留量');
  if (quotaBytes + await declaredQuota(tx, backend.id, previous?.id) > backend.budgetBytes) throw quotaExceeded('后端可分配空间预算不足');
  if (previous?.planId === plan.id && previous.planRevision === plan.revision) return previous;
  const space: ObjectSpaceRecord = {
    id: previous?.id ?? input.id, projectId: input.projectId, serviceId: input.serviceId, env: input.env,
    backendId: backend.id, backendPlacementRevision: backend.placementRevision, planId: plan.id, planRevision: plan.revision,
    revision: (previous?.revision ?? 0) + 1, health: backend.health, quotaBytes,
    ...(previous?.quotaOverrides ? { quotaOverrides: previous.quotaOverrides, quotaRevision: previous.quotaRevision, quotaSource: 'project' as const } : {}),
    maxObjectBytes: previous?.quotaOverrides?.maxObjectBytes ?? plan.maxObjectBytes, maxConcurrentTransfers: previous?.quotaOverrides?.maxConcurrentTransfers ?? plan.maxConcurrentTransfers, activeTransfers: previous?.activeTransfers ?? 0,
    usedBytes: previous?.usedBytes ?? 0, reservedBytes: previous?.reservedBytes ?? 0, deletingBytes: previous?.deletingBytes ?? 0,
    objectCount: previous?.objectCount ?? 0, enabled: true, createdAt: previous?.createdAt ?? now.toISOString(),
  };
  await tx.insert(objectSpaces).values({ id: space.id, projectId: space.projectId, serviceId: space.serviceId, env: space.env, backendId: space.backendId, body: space })
    .onConflictDoUpdate({ target: objectSpaces.id, set: { body: space } });
  return space;
}

function controlOperations(db: Database): Pick<ObjectCatalogRepository, 'applyWriteControl' | 'freeze' | 'freezeStatus'> {
  return {
    freezeStatus: (id) => objectStorageTransaction(db, (tx) => objectFreezeStatus(tx, id)),
    applyWriteControl: (control) => objectStorageTransaction(db, async (tx) => {
      const previous = (await tx.select().from(objectWriteControls).where(eq(objectWriteControls.serviceId, control.serviceId)))[0]?.body;
      if (previous && (control.controlVersion < previous.controlVersion || control.epoch < previous.epoch)) return false;
      if (previous?.controlVersion === control.controlVersion) { assertSameStorageRequest(jsonHash(previous), jsonHash(control)); return true; }
      await tx.insert(objectWriteControls).values({ serviceId: control.serviceId, body: control }).onConflictDoUpdate({ target: objectWriteControls.serviceId, set: { body: control } });
      return true;
    }),
    freeze: (input) => objectStorageTransaction(db, async (tx) => {
      const previous = (await tx.select().from(objectStorageFreezes).where(eq(objectStorageFreezes.id, input.id)))[0]?.body;
      if (previous && input.epoch < previous.epoch) return false;
      if (previous && (previous.kind !== input.kind || previous.backendId !== input.backendId)) throw conflict('冻结操作身份不能改变');
      if (previous && input.epoch === previous.epoch && !previous.active && input.active) return false;
      await tx.insert(objectStorageFreezes).values({ id: input.id, body: input }).onConflictDoUpdate({ target: objectStorageFreezes.id, set: { body: input } });
      return true;
    }),
  };
}

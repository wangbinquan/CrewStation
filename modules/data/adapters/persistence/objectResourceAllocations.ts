import type { Database, Transaction } from '@crewstation/persistence';
import type { ObjectCatalogRepository } from '../../ports/objectStorage';
import type { ObjectResourceCommand } from '../../domain/resourceAllocation';
import { conflict, jsonHash, notFound, precondition, quotaExceeded, validation } from '@crewstation/kernel';
import { ResourceIdSchema } from '@crewstation/contracts';
import { and, eq } from 'drizzle-orm';
import { objectPlanAllocationRevision, objectSpaceAllocationRevision } from '../../api/allocationRevision';
import { resourceAllocations } from './resourceAllocationTable';
import { objectPlans, objectProjectPolicies, objectSpaces } from './objectTables';
import { assertObjectStorageUnfrozen, objectStorageTransaction, requireObjectBackend, requireObjectSpace, saveObjectSpace } from './objectMetadata';

async function changeQuota(tx: Transaction, input: ObjectResourceCommand) {
  const space = await requireObjectSpace(tx, input.target.resourceId);
  if (space.projectId !== input.projectId) throw notFound('对象空间');
  if (objectSpaceAllocationRevision(space) !== input.expectedRevision) throw conflict('对象空间配额已变化');
  const { quotaGiB, maxObjectGiB, maxConcurrentTransfers } = input.values;
  if (Object.keys(input.values).some((key) => !['quotaGiB', 'maxObjectGiB', 'maxConcurrentTransfers'].includes(key)) || typeof quotaGiB !== 'number' || typeof maxObjectGiB !== 'number' || typeof maxConcurrentTransfers !== 'number') throw validation('对象配额参数不正确');
  const quotaBytes = Math.round(quotaGiB * 1024 ** 3), maxObjectBytes = Math.round(maxObjectGiB * 1024 ** 3);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1 || !Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1 || maxObjectBytes > quotaBytes || !Number.isInteger(maxConcurrentTransfers) || maxConcurrentTransfers < 1 || maxConcurrentTransfers > 1000) throw validation('对象配额超出允许范围');
  const backend = await requireObjectBackend(tx, space.backendId); await assertObjectStorageUnfrozen(tx, backend.id);
  if (quotaBytes < space.usedBytes + space.reservedBytes + space.deletingBytes) throw precondition('新配额低于已用、预留和待删除容量之和');
  const declared = (await tx.select().from(objectSpaces).where(eq(objectSpaces.backendId, backend.id))).reduce((sum, row) => sum + (row.id === space.id ? 0 : row.body.quotaBytes), 0);
  if (quotaBytes + declared > backend.budgetBytes) throw quotaExceeded('对象后端的可分配预算不足');
  const next = { ...space, quotaBytes, maxObjectBytes, maxConcurrentTransfers, quotaOverrides: { quotaBytes, maxObjectBytes, maxConcurrentTransfers }, quotaRevision: (space.quotaRevision ?? 0) + 1, quotaSource: 'project' as const, revision: space.revision + 1 };
  await saveObjectSpace(tx, next);
  return { revision: objectSpaceAllocationRevision(next), effect: '空间独立配额已生效；继续使用原后端，已有传输完成后按新并发上限准入', applied: true };
}
async function changePlan(tx: Transaction, input: ObjectResourceCommand) {
  if (!['grant', 'revoke'].includes(input.target.action) || Object.keys(input.values).length) throw validation('对象档位分配参数不适用');
  const plan = (await tx.select().from(objectPlans).where(eq(objectPlans.id, input.target.resourceId)))[0]?.body; if (!plan) throw notFound('对象档位');
  const original = (await tx.select().from(objectProjectPolicies).where(eq(objectProjectPolicies.projectId, input.projectId)))[0]?.body ?? { projectId: input.projectId, revision: 1, planIds: [] };
  if (objectPlanAllocationRevision(original.revision, plan) !== input.expectedRevision) throw conflict('对象档位或项目分配已变化');
  if (input.target.action === 'grant') {
    const backend = await requireObjectBackend(tx, plan.backendId); await assertObjectStorageUnfrozen(tx, backend.id);
    if (!plan.enabled || backend.state !== 'active') throw precondition('对象档位或后端已停用');
    if (plan.quotaBytes > backend.budgetBytes) throw quotaExceeded('对象档位超过后端分配预算');
  }
  const ids = original.planIds.filter((id) => id !== plan.id);
  if (input.target.action === 'grant') ids.push(plan.id);
  const policy = { ...original, planIds: ids, revision: original.revision + 1 };
  await tx.insert(objectProjectPolicies).values({ projectId: input.projectId, body: policy }).onConflictDoUpdate({ target: objectProjectPolicies.projectId, set: { body: policy } });
  return { revision: objectPlanAllocationRevision(policy.revision, plan), effect: '对象档位授权已更新；现有对象保留，新增空间仍需应用声明并通过后端预算及耐久检查', applied: true };
}
export function objectResourceAllocations(db: Database): Pick<ObjectCatalogRepository, 'applyResourceChange' | 'resourceChangeReceipt'> {
  return {
    resourceChangeReceipt: async (projectId, operationId) => { const r = (await db.select().from(resourceAllocations).where(and(eq(resourceAllocations.projectId, projectId), eq(resourceAllocations.operationId, operationId))))[0]?.body; return r ? { revision: r.revision, effect: r.effect, applied: r.applied } : undefined; },
    applyResourceChange: (input) => objectStorageTransaction(db, async (tx) => {
      ResourceIdSchema.parse(input.operationId); const hash = jsonHash(input);
      const old = (await tx.select().from(resourceAllocations).where(eq(resourceAllocations.operationId, input.operationId)))[0];
      if (old) { if (old.projectId !== input.projectId || old.body.hash !== hash) throw conflict('同一资源操作不能改变内容'); return { revision: old.body.revision, effect: old.body.effect, applied: old.body.applied }; }
      const receipt = input.target.resourceType === 'object-space' && input.target.action === 'set-quota' ? await changeQuota(tx, input) : input.target.resourceType === 'object-plan' ? await changePlan(tx, input) : undefined;
      if (!receipt) throw validation('不支持的对象资源变更');
      await tx.insert(resourceAllocations).values({ operationId: input.operationId, projectId: input.projectId, body: { hash, ...receipt } });
      return receipt;
    }),
  };
}

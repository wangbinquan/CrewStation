import { and, eq } from 'drizzle-orm';
import { ArchivePlanPageSchema, OBJECT_STORAGE_LIMITS, type ArchivePlanEntry } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ArchivePlanRecord } from '../../../domain/objectStorage';
import { assertSameStorageRequest, assertStorageRevision } from '../../../domain/objectStorage';
import type { ArchivePlanAuthority, ArchivePlanRepository } from '../../../ports/archivePlans';
import { assertObjectStorageUnfrozen, authorizeObjectWrite, objectStorageTransaction, requireObjectSpace } from '../objectCatalog';
import { archivePlans } from '../objectTables';
import { archiveObjects, archiveReferences } from './references';
import { archivePlanFile } from './planFile';

export async function requireArchivePlan(tx: Executor, id: string): Promise<ArchivePlanRecord> {
  const plan = (await tx.select().from(archivePlans).where(eq(archivePlans.id, id)))[0]?.body;
  if (!plan) throw notFound('归档清单'); return plan;
}
export async function saveArchivePlan(tx: Executor, plan: ArchivePlanRecord): Promise<ArchivePlanRecord> {
  await tx.update(archivePlans).set({ body: plan }).where(eq(archivePlans.id, plan.id)); return plan;
}
async function writablePlan(tx: Executor, id: string, authority: ArchivePlanAuthority, now: Date) {
  const plan = await requireArchivePlan(tx, id);
  await authorizePlan(tx, plan.spaceId, authority, now);
  return plan;
}
function appendEntries(plan: ArchivePlanRecord, entries: ArchivePlanEntry[]): readonly ArchivePlanEntry[] {
  const combined = [...plan.entries, ...entries], names = new Set<string>(), paths = new Set<string>();
  if (combined.length > OBJECT_STORAGE_LIMITS.archiveFiles) throw validation('归档清单超过文件数上限');
  if (new TextEncoder().encode(JSON.stringify(combined)).byteLength > OBJECT_STORAGE_LIMITS.manifestBytes) throw validation('归档清单超过总字节上限');
  for (const entry of combined) {
    if (names.has(entry.name)) throw conflict('归档清单的产物别名重复'); names.add(entry.name);
    if (entry.kind === 'file') { if (paths.has(entry.path)) throw conflict('归档清单的文件路径重复'); paths.add(entry.path); }
  }
  return combined;
}
async function pinEntries(tx: Executor, plan: ArchivePlanRecord, entries: readonly ArchivePlanEntry[], now: Date) {
  const objectIds = entries.flatMap((e) => e.kind === 'object' ? [e.objectId] : []);
  const objects = new Map((await archiveReferences(tx, plan.spaceId, objectIds, { type: 'archive-pending', id: plan.id, revision: 1 }, 'active', now)).map((o) => [o.id, o]));
  const bytes = entries.reduce((sum, e) => sum + (e.kind === 'file' ? e.expectedSize ?? 0 : objects.get(e.objectId)!.size), plan.byteCount);
  const ids = new Set([...plan.pinnedObjectIds, ...objectIds]);
  if (bytes > OBJECT_STORAGE_LIMITS.archiveBytes) throw validation('归档内容超过总大小上限');
  return { bytes, ids: [...ids] };
}

export function archivePlanRepository(db: Database): ArchivePlanRepository {
  return {
    get: async (id) => (await db.select().from(archivePlans).where(eq(archivePlans.id, id)))[0]?.body,
    file: async (id, path) => (await archivePlanFile(db, id, path))?.entry ?? undefined,
    create: (spaceId, taskId, id, requestKey, authority) => objectStorageTransaction(db, async (tx, now) => {
      await authorizePlan(tx, spaceId, authority, now);
      const previous = (await tx.select().from(archivePlans).where(and(eq(archivePlans.taskId, taskId), eq(archivePlans.requestKey, requestKey))))[0]?.body;
      if (previous) { if (previous.spaceId !== spaceId) throw notFound('归档清单'); return previous; }
      const plan: ArchivePlanRecord = { id, taskId: taskId as ArchivePlanRecord['taskId'], spaceId, requestKey, revision: 1, state: 'draft', digest: null, itemCount: 0, byteCount: 0,
        operator: authority.operator, entries: [], pageDigests: {}, pageRequests: {}, pinnedObjectIds: [], sealedByRequestKey: null, createdAt: now.toISOString() };
      await tx.insert(archivePlans).values({ id, taskId, spaceId, requestKey, body: plan }); return plan;
    }),
    append: (id, request, authority) => objectStorageTransaction(db, async (tx, now) => {
      const plan = await writablePlan(tx, id, authority, now), input = ArchivePlanPageSchema.parse(request);
      const { fence: _fence, ...parameters } = input, digest = jsonHash(parameters);
      if (Object.hasOwn(plan.pageRequests, input.requestKey)) { assertSameStorageRequest(plan.pageRequests[input.requestKey]!, digest); return plan; }
      if (plan.state !== 'draft') throw precondition('已封存或绑定的清单不能追加条目');
      assertStorageRevision(plan.revision, input.expectedRevision);
      if (input.page !== Object.keys(plan.pageDigests).length) throw conflict('归档清单页码不连续或已使用');
      const entries = appendEntries(plan, input.entries), pinned = await pinEntries(tx, plan, input.entries, now);
      return saveArchivePlan(tx, { ...plan, revision: plan.revision + 1, entries, itemCount: entries.length, byteCount: pinned.bytes, pinnedObjectIds: pinned.ids,
        pageDigests: { ...plan.pageDigests, [input.page]: jsonHash(input.entries) }, pageRequests: { ...plan.pageRequests, [input.requestKey]: digest } });
    }),
    seal: (id, requestKey, expectedRevision, authority) => objectStorageTransaction(db, async (tx, now) => {
      const plan = await writablePlan(tx, id, authority, now);
      if (plan.sealedByRequestKey === requestKey) { if (plan.revision !== expectedRevision + 1) throw conflict('封存幂等键的修订不同'); return plan; }
      if (Object.hasOwn(plan.pageRequests, requestKey)) throw conflict('幂等键已用于清单页');
      assertStorageRevision(plan.revision, expectedRevision);
      if (plan.state !== 'draft') throw precondition('清单已经封存或绑定');
      if (!plan.entries.length) throw precondition('空清单应使用明确的 noArtifactsReason');
      await archiveObjects(tx, plan.spaceId, plan.pinnedObjectIds);
      return saveArchivePlan(tx, { ...plan, revision: plan.revision + 1, state: 'sealed', digest: jsonHash({ taskId: plan.taskId, entries: plan.entries }), sealedByRequestKey: requestKey });
    }),
    abort: (id, expectedRevision, authority) => objectStorageTransaction(db, async (tx, now) => {
      const plan = await writablePlan(tx, id, authority, now);
      if (plan.state === 'aborted' && plan.revision === expectedRevision + 1) return plan;
      assertStorageRevision(plan.revision, expectedRevision);
      if (plan.state === 'bound') throw precondition('清单已归属终结操作，不能由应用解除引用');
      if (plan.state === 'aborted') return plan;
      await archiveReferences(tx, plan.spaceId, plan.pinnedObjectIds, { type: 'archive-pending', id: plan.id, revision: 1 }, 'released', now);
      return saveArchivePlan(tx, { ...plan, revision: plan.revision + 1, state: 'aborted' });
    }),
  };
}

async function authorizePlan(tx: Executor, spaceId: string, authority: ArchivePlanAuthority, now: Date) {
  const space = await requireObjectSpace(tx, spaceId);
  if (!authority.operator) return authorizeObjectWrite(tx, space, authority.source, authority.fence, now);
  if (space.projectId !== authority.source.projectId || space.serviceId !== authority.source.serviceId || space.env !== 'production') throw notFound('归档对象空间');
  if (!authority.operator.reason.trim()) throw validation('代为准备清单需要明确原因');
  await assertObjectStorageUnfrozen(tx, space.backendId);
}

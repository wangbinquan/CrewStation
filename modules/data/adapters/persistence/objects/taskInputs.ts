import { eq } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import type { TaskId } from '@crewstation/contracts';
import { OBJECT_STORAGE_LIMITS, TaskInputObjectsSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition } from '@crewstation/kernel';
import { jsonDocument, type Database, type Executor } from '@crewstation/persistence';
import type { PrepareTaskInputs, TaskInputGrant, TaskInputRepository, TaskInputsRecord } from '../../../ports/taskInputs';
import { assertSameStorageRequest } from '../../../domain/objectStorage';
import { dataSchema } from '../schema';
import { objectSpaces } from '../objectTables';
import { assertObjectStorageUnfrozen, objectStorageTransaction } from '../objectCatalog';
import { archiveObjects, archiveReferences } from '../archive/references';

const taskInputs = dataSchema.table('task_object_inputs', { taskId: text('task_id').primaryKey(), body: jsonDocument('body').$type<TaskInputsRecord>().notNull() });
const grants = dataSchema.table('task_input_grants', { id: text('id').primaryKey(), taskId: text('task_id').notNull(), body: jsonDocument('body').$type<TaskInputGrant>().notNull() });
async function read(tx: Executor, taskId: TaskId) { return (await tx.select().from(taskInputs).where(eq(taskInputs.taskId, taskId)))[0]?.body; }
async function save(tx: Executor, body: TaskInputsRecord) { await tx.update(taskInputs).set({ body }).where(eq(taskInputs.taskId, body.taskId)); }
async function requireInputs(tx: Executor, taskId: TaskId, generation?: number) {
  const record = await read(tx, taskId);
  if (!record) throw notFound('任务输入');
  if (generation !== undefined && record.generation !== generation) throw conflict('任务输入世代不一致'); return record;
}
async function unfrozen(tx: Executor, record: TaskInputsRecord) {
  const space = (await tx.select().from(objectSpaces).where(eq(objectSpaces.id, record.spaceId)))[0]?.body;
  if (!space) throw notFound('任务对象空间'); await assertObjectStorageUnfrozen(tx, space.backendId);
}
async function authenticate(tx: Executor, id: string, tokenHash: string, podUid: string, now: Date) {
  const grant = (await tx.select().from(grants).where(eq(grants.id, id)))[0]?.body;
  if (!grant || grant.tokenHash !== tokenHash || !grant.podUid || grant.podUid !== podUid || Date.parse(grant.expiresAt) <= now.getTime()) throw forbidden('任务输入凭证无效或已到期');
  const record = await requireInputs(tx, grant.taskId, grant.generation);
  if (!['prepared', 'active'].includes(record.state)) throw forbidden('任务输入授权已关闭');
  return { record, source: { projectId: record.projectId, serviceId: record.serviceId, env: 'production' as const, fenced: false } };
}
export function taskInputRepository(db: Database): TaskInputRepository {
  return {
    prepare: (input) => prepare(db, input),
    commit: (id, generation) => objectStorageTransaction(db, async (tx) => {
      const record = await requireInputs(tx, id, generation); if (record.state === 'active') return;
      if (record.state !== 'prepared') throw conflict('任务输入已经关闭'); await unfrozen(tx, record); await save(tx, { ...record, state: 'active' });
    }),
    abort: (id, generation, retryable) => objectStorageTransaction(db, async (tx, now) => {
      const record = await read(tx, id); if (!record) return;
      if (record.generation !== generation || record.state === 'active' || record.state === 'released') throw conflict('已准入任务输入不能按失败准备释放');
      if (record.state === 'aborted') { if (record.retryable !== retryable) throw conflict('任务输入释放原因不一致'); return; }
      await unfrozen(tx, record);
      await archiveReferences(tx, record.spaceId, record.items.map((i) => i.objectId), { type: 'task', id, revision: record.referenceRevision }, 'released', now);
      await save(tx, { ...record, state: 'aborted', retryable });
    }),
    issue: (taskId, generation, id, tokenHash) => objectStorageTransaction(db, async (tx, now) => {
      const record = await requireInputs(tx, taskId, generation);
      if (!['prepared', 'active'].includes(record.state)) throw precondition('任务输入不再有效');
      const old = (await tx.select().from(grants).where(eq(grants.id, id)))[0]?.body;
      if (old) { if (old.taskId !== taskId || old.generation !== generation || old.tokenHash !== tokenHash) throw conflict('输入授权身份冲突'); return; }
      await tx.insert(grants).values({ id, taskId, body: { id, taskId, generation, tokenHash, podUid: null, expiresAt: new Date(now.getTime() + 65 * 60_000).toISOString() } });
    }),
    bind: (id, podUid) => objectStorageTransaction(db, async (tx) => {
      const grant = (await tx.select().from(grants).where(eq(grants.id, id)))[0]?.body;
      if (!grant) throw notFound('任务输入授权'); if (grant.podUid && grant.podUid !== podUid) throw conflict('输入授权已绑定其他 Pod');
      await tx.update(grants).set({ body: { ...grant, podUid } }).where(eq(grants.id, id));
    }),
    authenticate: (id, hash, pod) => authenticate(db, id, hash, pod, new Date()),
    complete: (id, hash, pod) => objectStorageTransaction(db, async (tx, now) => {
      const { record } = await authenticate(tx, id, hash, pod, now); if (record.completedAt) return;
      await unfrozen(tx, record); await save(tx, { ...record, completedAt: now.toISOString() });
    }),
  };
}
async function prepare(db: Database, input: PrepareTaskInputs) {
  const items = TaskInputObjectsSchema.parse(input.items), digest = jsonHash({ ...input, items });
  await objectStorageTransaction(db, async (tx, now) => {
    const previous = await read(tx, input.taskId);
    if (previous) {
      assertSameStorageRequest(previous.digest, digest);
      if (previous.state === 'released' || previous.state === 'aborted' && !previous.retryable) throw conflict('任务输入已永久关闭');
      if (previous.state !== 'aborted') return;
    }
    const spaces = (await tx.select().from(objectSpaces).where(eq(objectSpaces.serviceId, input.serviceId))).map((r) => r.body);
    const space = spaces.find((s) => s.env === 'production' && s.projectId === input.projectId);
    if (!space?.enabled || space.health !== 'ready') throw precondition('任务输入对象空间不可用');
    await assertObjectStorageUnfrozen(tx, space.backendId);
    const objects = await archiveObjects(tx, space.id, items.map((i) => i.objectId));
    const fixed = items.map((i) => { const object = objects.find((o) => o.id === i.objectId)!; if (object.sha256 !== i.sha256) throw conflict('任务输入摘要不匹配'); return { ...i, size: object.size }; });
    if (fixed.reduce((sum, i) => sum + i.size, 0) > OBJECT_STORAGE_LIMITS.archiveBytes) throw precondition('任务输入总字节数超过上限');
    const record: TaskInputsRecord = { ...input, items: fixed, spaceId: space.id, digest, referenceRevision: (previous?.referenceRevision ?? 0) + 1, state: 'prepared', retryable: true, completedAt: null };
    await archiveReferences(tx, space.id, items.map((i) => i.objectId), { type: 'task', id: input.taskId, revision: record.referenceRevision }, 'active', now);
    await tx.insert(taskInputs).values({ taskId: input.taskId, body: record }).onConflictDoUpdate({ target: taskInputs.taskId, set: { body: record } });
  });
}
/** Only the receipt/reclaim transaction can release admitted task pins. No application unpin endpoint exists. */
export async function releaseTaskInputs(tx: Executor, taskId: TaskId, now: Date): Promise<void> {
  const record = await read(tx, taskId); if (!record || record.state === 'released') return;
  await archiveReferences(tx, record.spaceId, record.items.map((i) => i.objectId), { type: 'task', id: taskId, revision: record.referenceRevision }, 'released', now);
  await save(tx, { ...record, state: 'released', retryable: false });
}

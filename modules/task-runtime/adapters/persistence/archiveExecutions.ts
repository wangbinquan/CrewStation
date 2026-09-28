import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import { jsonDocument } from '@crewstation/persistence';
import type { Database, Executor } from '@crewstation/persistence';
import type { ArchiveExecution } from '../../domain/archiveExecution';
import { archiveDeclaration } from '../../domain/archiveExecution';
import type { ArchiveExecutionStore } from '../../ports/archiveExecution';
import type { EnvironmentLedger } from '../../ports/ledger';
import { taskRuntimeSchema } from './schema';
import { environments } from './tables';

const executions = taskRuntimeSchema.table('archive_executions', { id: text('id').primaryKey(), taskId: text('task_id').notNull(), state: text('state').notNull(), body: jsonDocument('body').$type<ArchiveExecution>().notNull() });
const get = async (db: Executor, id: string) => (await db.select().from(executions).where(eq(executions.id, id)))[0]?.body;
const active = async (db: Executor, taskId: string) => (await db.select().from(executions).where(and(eq(executions.taskId, taskId), ne(executions.state, 'stopped'))).limit(1))[0]?.body;
const lock = (db: Executor, taskId: string) => db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-runtime.archive:${taskId}`},0))`);
const save = async (db: Executor, e: ArchiveExecution) => { await db.update(executions).set({ state: e.state, body: e }).where(eq(executions.id, e.id)); return e; };

async function requireParent(tx: Executor, e: ArchiveExecution): Promise<void> {
  const parent = (await tx.select().from(environments).where(eq(environments.id, e.taskId)).for('update'))[0];
  const finalization = parent?.render?.storageFinalization;
  if (!parent || parent.state !== 'releasing' || parent.projectId !== e.projectId || parent.serviceId !== e.serviceId || parent.kind !== 'business' || parent.native
    || !finalization?.computeStopped || finalization.operationId !== e.operationId || finalization.revision !== e.revision || finalization.volumeUid !== e.volumeUid
    || parent.businessWorkspace?.volumeUid != null && parent.businessWorkspace.volumeUid !== e.volumeUid || parent.namespace !== e.namespace || parent.pvcName !== e.pvcName) throw precondition('归档任务尚未停止或原卷身份已变化');
}

export function archiveExecutionStore(db: Database, ledger: EnvironmentLedger): ArchiveExecutionStore {
  const change = <T>(id: string, work: (tx: Executor, e: ArchiveExecution, now: string) => Promise<T>) => db.transaction(async (tx) => {
    const first = await get(tx, id); if (!first) throw notFound('归档执行');
    await lock(tx, first.taskId); return work(tx, (await get(tx, id))!, new Date().toISOString());
  });
  return {
    get: (id) => get(db, id), active: (id) => active(db, id),
    list: async (after) => (await db.select().from(executions).where(and(ne(executions.state, 'stopped'), after ? gt(executions.id, after) : undefined)).orderBy(executions.id).limit(50)).map((r) => r.body),
    record: (id) => ledger.within(db).find(id, 'archive-execution'),
    prepare: (e) => db.transaction(async (tx) => {
      await lock(tx, e.taskId); await requireParent(tx, e);
      const previous = await active(tx, e.taskId);
      if (previous) {
        if (previous.operationId !== e.operationId || previous.revision !== e.revision || previous.volumeUid !== e.volumeUid) throw conflict('旧归档助手尚未停止');
        return previous;
      }
      const scope = and(eq(executions.taskId, e.taskId), sql`${executions.body}->>'operationId' = ${e.operationId}`, sql`(${executions.body}->>'revision')::int = ${e.revision}`);
      const last = (await tx.select().from(executions).where(scope).orderBy(desc(executions.id)).limit(1))[0]?.body;
      if (last) {
        const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(executions).where(scope);
        const nextRetryAt = new Date(Date.parse(last.updatedAt) + Math.min(300_000, 60_000 * 2 ** Math.min(3, (count?.n ?? 1) - 1))).toISOString();
        if (Date.parse(nextRetryAt) > Date.now()) throw precondition('归档助手已停止，等待退避后重新申请', { code: 'archive_retry_pending', nextRetryAt });
      }
      await tx.insert(executions).values({ id: e.id, taskId: e.taskId, state: e.state, body: e }); return e;
    }),
    admit: (id) => change(id, async (tx, e, now) => {
      if (e.state !== 'queued') return e;
      await requireParent(tx, e);
      const admitted: ArchiveExecution = { ...e, state: 'admitted', expiresAt: new Date(Date.parse(now) + 60 * 60_000).toISOString(), updatedAt: now };
      await ledger.within(tx).admit(archiveDeclaration(admitted)); return save(tx, admitted);
    }),
    bind: (id, podUid, secretUid) => change(id, async (tx, e, now) => {
      if (e.podUid && (e.podUid !== podUid || e.secretUid !== secretUid)) throw conflict('归档助手实例已变化');
      if (e.state === 'queued' || e.state === 'stopped') throw precondition('归档助手不再等待绑定');
      await save(tx, { ...e, podUid, secretUid, updatedAt: now });
      await ledger.within(tx).report(id, { conditions: [{ type: 'Provisioning', status: 'false' }] });
    }),
    stopping: (id) => change(id, async (tx, e, now) => {
      if (e.state === 'stopped') return;
      const writer = ledger.within(tx), record = await writer.find(id, 'archive-execution');
      if (record) { await writer.report(id, { conditions: [{ type: 'Provisioning', status: 'false' }] }); await writer.requestRelease(id, { code: 'archive-finished', message: '正在结束归档助手，保留原任务卷' }); }
      await save(tx, { ...e, state: 'stopping', updatedAt: now });
    }),
    stopped: (id) => change(id, async (tx, e, now) => {
      if (e.state === 'stopped') return;
      if (e.state !== 'stopping') throw precondition('归档助手尚未进入停止流程');
      const record = await ledger.within(tx).find(id, 'archive-execution');
      if (record && (record.desired !== 'absent' || record.phase !== 'stopped')) throw precondition('归档助手及其凭据尚未清理');
      await save(tx, { ...e, state: 'stopped', updatedAt: now });
    }),
  };
}

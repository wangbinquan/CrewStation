import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { ResourceIdSchema, WorkloadConsumerSchema, WorkloadStartPermitSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { WorkloadConsumerState, WorkloadSafety } from '../../../api/workloadSafety';
import { drizzleRecordRepository } from '../drizzleRecords';
import { assertConsumerOwner, assertTaskAllowsConsumer, lockStorageTask, requireConsumer } from './guards';
import { admissionClosures, consumers, storageFences, stopProofs } from './tables';
import { workloadAdmissionClosures } from './admissionClosures';
import { workloadStopBarrier } from './stopBarrier';
import { needsDevelopmentOwnerCheck } from './development';

async function state(tx: Executor, row: typeof consumers.$inferSelect): Promise<WorkloadConsumerState> {
  const proof = (await tx.select().from(stopProofs).where(eq(stopProofs.consumerId, row.id)))[0];
  return { consumer: row.consumer, admissionClosed: row.admissionClosed, startPermit: row.startPermit, stopProof: proof?.record ?? null };
}
export function workloadSafetyRepository(db: Database): WorkloadSafety {
  const mutate = <T>(id: string, run: (tx: Executor, row: typeof consumers.$inferSelect) => Promise<T>) => db.transaction(async (tx) => {
    const prior = await requireConsumer(tx, id); await lockStorageTask(tx, prior.taskId); return run(tx, await requireConsumer(tx, id));
  });
  return {
    ...workloadStopBarrier(db),
    ...workloadAdmissionClosures(db),
    get: async (id) => { const row = (await db.select().from(consumers).where(eq(consumers.id, id)))[0]; return row ? state(db, row) : undefined; },
    list: async (taskId, after) => {
      const rows = await db.select({ consumer: consumers, proof: stopProofs.record }).from(consumers).leftJoin(stopProofs, eq(stopProofs.consumerId, consumers.id))
        .where(and(eq(consumers.taskId, taskId), after ? gt(consumers.id, after) : undefined)).orderBy(asc(consumers.id)).limit(101);
      return { items: rows.slice(0, 100).map(({ consumer: row, proof }) => ({ consumer: row.consumer, admissionClosed: row.admissionClosed, startPermit: row.startPermit, stopProof: proof })), next: rows.length > 100 ? rows[99]!.consumer.id : null };
    },
    register: (raw) => db.transaction(async (tx) => {
      const consumer = WorkloadConsumerSchema.parse(raw); await lockStorageTask(tx, consumer.taskId);
      const prior = (await tx.select().from(consumers).where(eq(consumers.id, consumer.id)))[0];
      if (prior) {
        if (jsonHash(prior.consumer) !== jsonHash(consumer)) throw conflict('消费者身份不可复用');
        const records = drizzleRecordRepository(tx);
        if (!prior.admissionClosed && needsDevelopmentOwnerCheck(await records.get(consumer.resourceId), await records.get(consumer.taskId), consumer)) {
          await assertConsumerOwner(tx, consumer); await assertTaskAllowsConsumer(tx, consumer);
        }
        return state(tx, prior);
      }
      if ((await tx.select().from(admissionClosures).where(eq(admissionClosures.id, consumer.id))).length) throw precondition('此消费者启动准入已封存', { code: 'workload_admission_closed' });
      await assertConsumerOwner(tx, consumer); await assertTaskAllowsConsumer(tx, consumer);
      await tx.insert(storageFences).values({ taskId: consumer.taskId }).onConflictDoNothing();
      const row = (await tx.insert(consumers).values({ id: consumer.id, taskId: consumer.taskId, resourceId: consumer.resourceId, namespace: consumer.namespace, podName: consumer.podName, consumer }).onConflictDoNothing().returning())[0];
      if (!row) throw conflict('消费者 Pod 名称或身份已经占用');
      return state(tx, row);
    }),
    closeConsumer: (id) => mutate(id, async (tx, row) => {
      if (!row.admissionClosed) await tx.update(consumers).set({ admissionClosed: true }).where(eq(consumers.id, id));
      return state(tx, { ...row, admissionClosed: true });
    }),
    freezeTask: (taskId, finalization) => db.transaction(async (tx) => {
      ResourceIdSchema.parse(finalization.operationId);
      if (!Number.isSafeInteger(finalization.revision) || finalization.revision < 1) throw conflict('终结修订无效');
      await lockStorageTask(tx, taskId);
      const parent = await drizzleRecordRepository(tx).get(taskId);
      if (!parent || parent.owner.module !== 'task-runtime' || parent.kind !== 'business-workspace') throw precondition('工作卷所属任务不存在');
      const fence = (await tx.select().from(storageFences).where(eq(storageFences.taskId, taskId)))[0], prior = fence?.finalization;
      if (prior && (prior.operationId !== finalization.operationId || finalization.revision < prior.revision || finalization.revision > prior.revision + 1)) throw conflict('任务终结身份或修订已变化');
      if (prior?.revision === finalization.revision) return;
      if (fence?.sealed) throw conflict('已经封存的终结不能切换修订');
      await tx.insert(storageFences).values({ taskId, finalization }).onConflictDoUpdate({ target: storageFences.taskId, set: { finalization } });
      await tx.update(consumers).set({ admissionClosed: true }).where(eq(consumers.taskId, taskId));
    }),
    grantStart: (id, input) => mutate(id, async (tx, row) => {
      if (row.admissionClosed) throw precondition('此消费者启动准入已关闭', { code: 'workload_admission_closed' });
      await assertTaskAllowsConsumer(tx, row.consumer); await assertConsumerOwner(tx, row.consumer, input);
      if ((await tx.select().from(stopProofs).where(eq(stopProofs.consumerId, id))).length) throw precondition('此消费者已确认停止', { code: 'workload_admission_closed' });
      if (row.startPermit) {
        if (jsonHash({ ...row.startPermit, grantedAt: null }) !== jsonHash({ ...input, grantedAt: null })) throw conflict('启动许可已绑定其他 Pod 或节点');
        return state(tx, row);
      }
      const at = (await tx.execute<{ at: string }>(sql`SELECT clock_timestamp()::text AS at`))[0]!.at;
      const startPermit = WorkloadStartPermitSchema.parse({ ...input, grantedAt: new Date(at).toISOString() });
      await tx.update(consumers).set({ startPermit }).where(eq(consumers.id, id)); return state(tx, { ...row, startPermit });
    }),
    recordStop: (raw) => {
      const proof = WorkloadStopProofSchema.parse(raw);
      return mutate(proof.consumer.id, async (tx, row) => {
        if (jsonHash(proof.consumer) !== jsonHash(row.consumer)) throw conflict('停止证明不属于此工作卷消费者');
        const permit = row.startPermit;
        if (permit && (permit.podUid !== proof.podUid || permit.nodeName !== proof.nodeName || permit.nodeUid !== proof.nodeUid)) throw conflict('停止证明不对应获准运行的 Pod 与节点');
        const previous = (await tx.select().from(stopProofs).where(eq(stopProofs.consumerId, row.id)))[0]?.record;
        if (previous) { if (previous.podUid !== proof.podUid) throw conflict('消费者停止证明不可替换'); return previous; }
        await tx.insert(stopProofs).values({ consumerId: row.id, record: proof });
        await tx.update(consumers).set({ admissionClosed: true }).where(eq(consumers.id, row.id)); return proof;
      });
    },
  };
}

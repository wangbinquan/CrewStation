import { eq } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { WorkloadAdmissionIdentity, WorkloadConsumer } from '@crewstation/contracts';
import { WorkloadAdmissionIdentitySchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { drizzleRecordRepository } from '../drizzleRecords';
import { admissionClosures, consumers } from './tables';
import { lockStorageTask } from './guards';

function identityOf(c: WorkloadConsumer): WorkloadAdmissionIdentity {
  const { id, taskId, revision, purpose, finalization, resourceId, namespace, podName } = c;
  return { consumer: { id, taskId, revision, purpose, finalization }, resourceId, namespace, podName };
}
/** Serializes with register/grant, including the interval before a PVC or Pod exists. */
export function workloadAdmissionClosures(db: Database) {
  return {
    admissionClosed: async (id: string) => !!(await db.select({ id: admissionClosures.id }).from(admissionClosures).where(eq(admissionClosures.id, id)))[0],
    closeAdmission: (raw: WorkloadAdmissionIdentity) => db.transaction(async (tx) => {
      const identity = WorkloadAdmissionIdentitySchema.parse(raw), id = identity.consumer.id;
      await lockStorageTask(tx, identity.consumer.taskId);
      const existing = (await tx.select().from(admissionClosures).where(eq(admissionClosures.id, id)))[0];
      if (existing) { if (jsonHash(existing.identity) !== jsonHash(identity)) throw conflict('启动关闭凭证不能更换消费者身份'); return; }
      const registered = (await tx.select().from(consumers).where(eq(consumers.id, id)))[0];
      if (registered) { if (jsonHash(identityOf(registered.consumer)) !== jsonHash(identity)) throw conflict('启动关闭凭证与登记的消费者不匹配'); }
      else {
        const record = await drizzleRecordRepository(tx).get(identity.resourceId);
        if (!record || record.owner.module !== 'task-runtime' || record.spec['workloadConsumerId'] !== id
          || (record.id !== identity.consumer.taskId && record.parentId !== identity.consumer.taskId)
          || !record.spec.children.some((c) => c.kind === 'Pod' && c.namespace === identity.namespace && c.name === identity.podName)) throw precondition('不能关闭不属于此执行记录的启动准入');
      }
      await tx.insert(admissionClosures).values({ id, identity });
      if (registered) await tx.update(consumers).set({ admissionClosed: true }).where(eq(consumers.id, id));
    }),
  };
}

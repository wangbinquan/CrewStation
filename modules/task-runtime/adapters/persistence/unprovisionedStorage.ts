import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import type { EnvironmentLedger } from '../../ports/ledger';
import type { UnprovisionedStorage } from '../../ports/unprovisionedStorage';
import { drizzleAdmissionRepository, drizzleEnvironmentRepository } from './drizzleRepositories';
import { taskRuntimeSchema } from './schema';

interface Tombstone { input: BusinessStorageFinalization; createdAt: string; proofId: string | null }
const table = taskRuntimeSchema.table('unprovisioned_storage', { taskId: text('task_id').primaryKey(), body: jsonDocument('body').$type<Tombstone>().notNull() });
const read = async (tx: Executor, id: string) => (await tx.select().from(table).where(eq(table.taskId, id)))[0]?.body;
function matches(row: Tombstone, input: BusinessStorageFinalization) {
  if (jsonHash(row.input) !== jsonHash(input)) throw conflict('未供给任务的终结身份已变化');
}
export function unprovisionedStorage(db: Database, ledger: EnvironmentLedger): UnprovisionedStorage {
  return {
    freeze: (input) => db.transaction(async (tx) => {
      ResourceIdSchema.parse(input.operationId);
      const admission = drizzleAdmissionRepository(tx); await admission.lock(input.projectId);
      const env = await drizzleEnvironmentRepository(tx).getById(input.taskId);
      if (env) return false;
      if (input.volumeUid !== null) throw precondition('曾存在工作卷的任务不能认定从未供给');
      const prior = await read(tx, input.taskId);
      if (prior) {
        if (prior.input.operationId !== input.operationId || prior.input.projectId !== input.projectId || prior.input.serviceId !== input.serviceId || input.revision < prior.input.revision || input.revision > prior.input.revision + 1 || prior.proofId && input.revision !== prior.input.revision) throw conflict('未供给终结身份不可替换');
        await tx.update(table).set({ body: { ...prior, input } }).where(eq(table.taskId, input.taskId)); return true;
      }
      const writer = ledger.within(tx);
      // An orphan declaration could already have issued a create; absence of the environment alone is insufficient.
      if (await writer.find(input.taskId, 'business-workspace') || await writer.find(`${input.taskId}/work`, 'volume')) throw precondition('发现未完成的原任务资源声明，不能证明从未供给');
      await admission.block(input.taskId, input.serviceId);
      const parent = await writer.declare({ id: input.taskId, kind: 'business-workspace', ref: input.taskId, projectId: input.projectId,
        spec: { children: [], neverProvisioned: true }, display: { completionPolicy: 'archive-and-delete' } });
      await writer.requestRelease(parent.id, { code: 'never-provisioned', message: '任务在准入前终结，未启动执行环境' });
      await writer.declare({ kind: 'volume', ref: `${input.taskId}/work`, projectId: input.projectId, parentId: input.taskId,
        spec: { children: [], reclaim: 'retain', neverProvisioned: true, taskStorage: { taskId: input.taskId, completionPolicy: 'archive-and-delete' } },
        display: { completionPolicy: 'archive-and-delete', disposition: 'never-provisioned' }, conditions: [{ type: 'Provisioning', status: 'false' }] });
      await tx.insert(table).values({ taskId: input.taskId, body: { input, createdAt: new Date().toISOString(), proofId: null } });
      return true;
    }),
    owns: async (input) => { const row = await read(db, input.taskId); if (!row) return false; matches(row, input); return true; },
    complete: (input, proofId) => db.transaction(async (tx) => {
      ResourceIdSchema.parse(proofId); await drizzleAdmissionRepository(tx).lock(input.projectId);
      const row = await read(tx, input.taskId); if (!row) throw precondition('从未供给墓碑尚未持久确认'); matches(row, input);
      if (row.proofId && row.proofId !== proofId) throw conflict('从未供给证明不可替换');
      await tx.update(table).set({ body: { ...row, proofId } }).where(eq(table.taskId, input.taskId));
    }),
  };
}

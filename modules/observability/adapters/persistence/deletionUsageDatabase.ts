import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { UsageTaskScope } from '../../ports/usageLedger';
import { authorizeObservationDeletion, currentObservationFence, observationOwnerTransaction, originalObservationScope } from './projectDeletion';
import type { ObservabilityDeletionInput } from './projectDeletion';

/** Each existing ledger transaction receives an unshared nonce, which is removed before commit.
 * HTTP/source I/O runs outside this transaction and never holds a project admission lock. */
export function observationDeletionUsageDatabase(input: ObservabilityDeletionInput, raw: ProjectDeletionContext, rawScope: UsageTaskScope): Database {
  const context = structuredClone(raw), scope = { projectId: ProjectIdSchema.parse(rawScope.projectId), taskId: TaskIdSchema.parse(rawScope.taskId) };
  if (context.phase !== 'stop' || scope.projectId !== context.target.id) throw precondition('观测数字提交只能使用当前原项目停止范围');
  const transaction: Database['transaction'] = async (callback) => {
    const granted = await authorizeObservationDeletion(input, context), original = await originalObservationScope(input, input.db, context.target);
    return observationOwnerTransaction(input, granted, original, async (tx) => {
      const fence = await currentObservationFence(tx, granted);
      if (!fence?.verified || fence.generation !== granted.generation || fence.phase_index !== 0) throw precondition('观测原封写未完成或停止已经完成');
      const nonce = crypto.randomUUID() + crypto.randomUUID(), taskKey = jsonHash(scope);
      await tx.execute(sql`SELECT set_config('crewstation.observability_drain',${nonce},true)`);
      await tx.execute(sql`INSERT INTO observability.deletion_drain_admissions(backend,transaction_id,nonce,project_id,operation_id,generation,task_id,task_key)
        VALUES(pg_backend_pid(),txid_current(),${nonce},${scope.projectId},${granted.operationId},${granted.generation},${scope.taskId},${taskKey})`);
      const result = await callback(tx);
      await input.assertGrant(granted);
      await tx.execute(sql`DELETE FROM observability.deletion_drain_admissions WHERE backend=pg_backend_pid() AND transaction_id=txid_current() AND nonce=${nonce}`);
      await tx.execute(sql`SELECT set_config('crewstation.observability_drain','',true)`);
      return result;
    });
  };
  return new Proxy(input.db, { get(target, property) {
    if (property === 'transaction') return transaction;
    if (property === 'execute') return (query: Parameters<Database['execute']>[0]) => transaction((tx) => tx.execute(query));
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { BusinessDeletionScope } from '../../../domain/deletion/projectDeletion';
import type { BusinessWorkSources } from '../../../ports/deletion/work';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { BUSINESS_CONTENT } from './contentTables';
import { inspectBusinessContent } from './inspection';

const order = ['finalization_execution_proofs', 'finalization_revisions', 'recovery_audit', 'subtask_projections', 'execution_sessions', 'execution_messages',
  'execution_events', 'execution_cancellations', 'execution_logs', 'execution_lifecycles', 'execution_materials', 'execution_task_states', 'execution_subtasks',
  'execution_session_homes', 'subtasks', 'legacy_mutations', 'cluster_commands', 'recovery_requests', 'finalizations', 'execution_operations', 'tasks',
  'contracts', 'execution_controls', 'storage_control_outbox', 'original_callbacks'];

/** Every deletion matches the frozen primary key and whole private row digest, in original child-before-parent order. */
export async function purgeBusinessContent(db: Executor, sources: BusinessWorkSources, context: ProjectDeletionContext, scope: BusinessDeletionScope) {
  if (scope.compacted) return;
  const current = await inspectBusinessContent(db, sources, context.target.id, context.target);
  if (jsonHash(current.contents) !== jsonHash(scope.contents)) throw precondition('业务封写后的原内容发生变化，不能删除替换记录');
  if (order.length !== BUSINESS_CONTENT.length || BUSINESS_CONTENT.some((entry) => !order.includes(entry.table))) throw precondition('业务删除顺序未覆盖全部内容');
  for (const table of order) {
    const entry = BUSINESS_CONTENT.find((item) => item.table === table)!;
    const key = sql.raw('jsonb_build_array(' + entry.keys.map((column) => 'r.' + column).join(',') + ')::text');
    const body = sql.raw(table === 'original_callbacks' ? "to_jsonb(r)-ARRAY['exited_at','exit_digest','recovery_digest']" : 'to_jsonb(r)');
    for (const item of scope.contents.filter((value) => value.table === table)) {
      const deleted = await db.execute(sql`DELETE FROM ${sql.raw('business_task.' + table)} r WHERE ${key}=${item.key}
        AND encode(sha256(convert_to((${body})::text,'UTF8')),'hex')=${item.digest} RETURNING ${key}`);
      if (deleted.length !== 1) throw precondition('业务原内容删除的数量或摘要不符');
    }
  }
}

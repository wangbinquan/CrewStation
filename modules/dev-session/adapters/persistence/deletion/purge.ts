import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DevelopmentDeletionScope } from '../../../domain/deletion/projectDeletion';
import type { DevelopmentWorkSources } from '../../../ports/deletion/work';
import { DEVELOPMENT_CONTENT } from './contentTables';
import { inspectDevelopmentContent } from './inspection';

const order = ['development_agent_endings', 'development_agent_usage', 'native_activity_reads', 'native_activity_items',
  'native_activity_states', 'native_activity_sources', 'native_activity_progress', 'workspace_layouts', 'comparison_references',
  'idle_reminders', 'cluster_agent_restarts', 'agent_starts', 'native_terminal_starts', 'original_callbacks'];

/** Delete only the original frozen keys and row digests; preserve all immutable minimum origins. */
export async function purgeDevelopmentContent(db: Executor, sources: DevelopmentWorkSources, context: ProjectDeletionContext, scope: DevelopmentDeletionScope) {
  if (scope.compacted) return;
  const current = await inspectDevelopmentContent(db, sources, context.target.id);
  if (jsonHash(current.contents) !== jsonHash(scope.contents)) throw precondition('开发封写后的原内容发生变化，不能删除替换记录');
  if (order.length !== DEVELOPMENT_CONTENT.length || DEVELOPMENT_CONTENT.some((entry) => !order.includes(entry.table))) throw precondition('开发删除顺序未覆盖全部内容');
  for (const table of order) {
    const entry = DEVELOPMENT_CONTENT.find((value) => value.table === table)!;
    const key = sql.raw('jsonb_build_array(' + entry.keys.map((column) => 'r.' + column).join(',') + ')::text');
    const body = sql.raw(table === 'original_callbacks' ? "to_jsonb(r)-ARRAY['exited_at','exit_digest','recovery_digest']" : 'to_jsonb(r)');
    for (const original of scope.contents.filter((value) => value.table === table)) {
      const removed = await db.execute(sql`DELETE FROM ${sql.raw('dev_session.' + table)} r WHERE ${key}=${original.key}
        AND encode(sha256(convert_to((${body})::text,'UTF8')),'hex')=${original.digest} RETURNING ${key}`);
      if (removed.length !== 1) throw precondition('开发原内容删除数量或摘要不符');
    }
  }
}

import type { ProjectDeletionContext, ProjectDeletionEvidence } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { RuntimeDeletionScope } from '../../../domain/deletion/projectDeletion';
import { runtimeWorkIdentity } from '../../../domain/deletion/work';
import type { RuntimeDeletionSources } from '../../../ports/deletion/sources';
import { RUNTIME_CONTENT } from './contentTables';
import { inspectRuntimeScope } from './scopeStore';
import { runtimeContentKey } from './rowStore';

const order = ['development_parent_ending_children', 'development_parent_ending_objects', 'development_parent_rebuild_claims',
  'archive_executions', 'unprovisioned_storage', 'blocked_admissions', 'development_parent_endings', 'environment_rebuilds', 'environments', 'admissions', 'original_callbacks'];
const payload = (scope: RuntimeDeletionScope['contents']) => scope.filter((row) => row.table !== 'original_callbacks');
/** Physical cleanup may add granted callback births; it cannot rewrite the stopped payload or invent ordinary work. */
function originalCallbacks(scope: RuntimeDeletionScope, current: RuntimeDeletionScope, context: ProjectDeletionContext) {
  const original = scope.stopped!.callbacks;
  if (original.some((row) => !current.callbacks.some((actual) => actual.id === row.id && runtimeWorkIdentity(actual) === runtimeWorkIdentity(row))))
    throw precondition('运行停止后的原回调已缺失或替换');
  for (const row of current.callbacks) {
    if (!row.exited) throw precondition('运行原回调仍未退出');
    if (!original.some((saved) => saved.id === row.id) && (!row.grant || row.grant.operationId !== context.operationId
      || row.grant.generation > context.generation || row.grant.phase === 'stop'))
      throw precondition('运行停止后出现未确认或错误世代的回调');
  }
}
export async function purgeRuntimeContent(db: Executor, sources: RuntimeDeletionSources, context: ProjectDeletionContext, scope: RuntimeDeletionScope): Promise<ProjectDeletionEvidence> {
  if (!scope.stopped) throw precondition('运行删除缺少停止后的完整冻结范围');
  const current = await inspectRuntimeScope(db, sources, context.target);
  if (jsonHash(payload(current.contents)) !== jsonHash(payload(scope.stopped.contents))) throw precondition('运行停止后的原内容发生变化，不能删除替换记录');
  originalCallbacks(scope, current.scope, context);
  if (order.length !== RUNTIME_CONTENT.length || RUNTIME_CONTENT.some((entry) => !order.includes(entry.table))) throw precondition('运行删除顺序未覆盖全部内容');
  for (const table of order) {
    const entry = RUNTIME_CONTENT.find((item) => item.table === table)!, key = runtimeContentKey(entry);
    const body = sql.raw(table === 'original_callbacks' ? "to_jsonb(r)-ARRAY['exited_at','exit_digest','recovery_digest']" : 'to_jsonb(r)');
    for (const item of current.contents.filter((value) => value.table === table)) {
      const removed = await db.execute(sql`DELETE FROM ${sql.raw('task_runtime.' + table)} r WHERE ${key}=${item.key}
        AND encode(sha256(convert_to((${body})::text,'UTF8')),'hex')=${item.digest} RETURNING ${key}`);
      if (removed.length !== 1) throw precondition('运行原内容删除的数量或整行摘要不符');
    }
  }
  return { kind: 'metadata', count: current.contents.length, digest: jsonHash({ operationId: context.operationId, phase: context.phase, contents: current.contents }),
    description: '原运行正文、原固定父成员与全部退出回调按整行摘要完整回收，仅保留最小身份和删除证明' };
}

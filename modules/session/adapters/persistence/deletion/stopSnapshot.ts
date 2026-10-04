import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionStopSnapshotSchema } from '../../../domain/deletion/stopSnapshot';
import { sessionWorkIdentity } from '../../../domain/deletion/work';
import type { SessionDeletionScope } from '../../../ports/projectDeletion';
import { sessionWorkHistory } from './workHistory';

export async function sessionCallbacksExited(db: Executor, context: ProjectDeletionContext, scope: SessionDeletionScope) {
  if ((await db.execute(sql`SELECT expected.id FROM jsonb_to_recordset(${JSON.stringify(scope.births.map(({ id, identity }) => ({ id, identity })))}::jsonb) AS expected(id text,identity text)
    LEFT JOIN session.connection_births actual ON actual.id=expected.id AND actual.identity=expected.identity
    WHERE actual.id IS NULL OR actual.exited_at IS NULL OR actual.exit_digest IS DISTINCT FROM actual.identity LIMIT 1`)).length) return false;
  const callbacks = await sessionWorkHistory(db, context.target.id);
  const byId = new Map(callbacks.map((callback) => [callback.id, callback.identity]));
  for (const birth of scope.callbacks ?? []) if (byId.get(birth.id) !== sessionWorkIdentity(birth))
    throw precondition('会话原命令完整出生范围已缺失或被替换');
  return callbacks.every((callback) => callback.exited) && !(await db.execute(sql`SELECT id FROM session.connection_births
    WHERE task_key IN(SELECT jsonb_array_elements_text(${JSON.stringify(scope.taskKeys)}::jsonb)) AND exited_at IS NULL LIMIT 1`)).length;
}
export async function captureSessionStop(db: Executor, context: ProjectDeletionContext, scope: SessionDeletionScope) {
  if (!(await sessionCallbacksExited(db, context, scope))) throw precondition('会话原连接与命令回调尚未全部退出');
  const [row] = await db.execute<{ body: unknown }>(sql`SELECT session.stop_snapshot(${context.target.id},${JSON.stringify(scope.taskKeys)}::jsonb) AS body`);
  return SessionStopSnapshotSchema.parse(row?.body);
}
export async function purgeSessionSnapshot(db: Executor, context: ProjectDeletionContext, scope: SessionDeletionScope) {
  if (!scope.stopped) throw precondition('会话清理缺少停止后完整内容快照');
  const actual = await captureSessionStop(db, context, scope);
  if (jsonHash(actual) !== jsonHash(scope.stopped)) throw precondition('会话停止后完整内容数量或行摘要发生变化');
  const selected = sql`SELECT jsonb_array_elements_text(${JSON.stringify(scope.taskKeys)}::jsonb)`;
  for (const table of scope.stopped.tables) {
    const predicate = table.table === 'original_callbacks' ? sql`project_id=${context.target.id}`
      : table.table === 'connection_births' ? sql`task_key IN(${selected})` : sql`task_id IN(${selected})`;
    const [removed] = await db.execute<{ count: string }>(sql`WITH deleted AS(DELETE FROM ${sql.raw('session.' + table.table)} WHERE ${predicate} RETURNING 1)
      SELECT count(*)::text AS count FROM deleted`);
    if (Number(removed?.count) !== table.count) throw precondition('会话停止后内容原子删除数量不符');
  }
}

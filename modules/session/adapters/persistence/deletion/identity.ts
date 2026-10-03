import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { SessionDeletionSources } from '../../../ports/projectDeletion';

export const SESSION_CONTENT = ['runner_events', 'connections', 'business_execution_events', 'business_usage_events', 'business_usage_sources',
  'business_stopped_executions', 'execution_completion_proofs', 'business_executions', 'development_usage_events', 'development_usage_streams'] as const;
export async function readSessionTask(sources: SessionDeletionSources, key: string) {
  const source = await sources.resolve(key);
  if (!source || source.complete !== true || !/^[a-f0-9]{64}$/.test(source.revision)
    || !['platform', 'project'].includes(source.scope) || (source.scope === 'platform' ? source.projectIds.length !== 0 : source.projectIds.length !== 1))
    throw precondition('会话原任务归属不完整');
  const id = TaskIdSchema.parse(source.id), projectId = source.scope === 'platform' ? null : ProjectIdSchema.parse(source.projectIds[0]);
  const material = { key, id, projectId, identity: source.revision };
  return material;
}
export async function registerSessionTask(db: Executor, sources: SessionDeletionSources, key: string) {
  const material = await readSessionTask(sources, key), { id, projectId, identity } = material;
  await db.execute(sql`SELECT set_config('crewstation.session_origin',${jsonHash(material)},true)`);
  await db.execute(sql`INSERT INTO session.task_origins(task_key,task_id,project_id,identity) VALUES(${key},${id},${projectId},${identity}) ON CONFLICT DO NOTHING`);
  const existing = (await db.execute<{ task_id: string; project_id: string | null; identity: string }>(sql`SELECT task_id,project_id,identity FROM session.task_origins WHERE task_key=${key}`))[0];
  if (!existing || existing.task_id !== id || existing.project_id !== projectId || existing.identity !== identity) throw precondition('会话原任务目录与实际来源冲突');
  return material;
}
export async function registeredSessionContent(db: Executor) {
  const actual = await db.execute<{ table_name: string }>(sql`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='session' AND column_name IN('task_id','task_key','project_id') ORDER BY table_name`);
  const expected = [...SESSION_CONTENT, 'task_origins', 'connection_births', 'project_deletions'].sort();
  if (jsonHash(actual.map((row) => row.table_name)) !== jsonHash(expected)) throw precondition('会话内容表未完整登记');
}

import { ProjectDeletionInventorySchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionBirthSchema, SessionDeletionScopeSchema } from '../../../domain/projectDeletion';
import type { SessionDeletionSources } from '../../../ports/projectDeletion';
import { readSessionTask, registeredSessionContent, SESSION_CONTENT } from './identity';

async function taskKeys(db: Executor, sources: SessionDeletionSources, target: ProjectDeletionTarget) {
  const own = new Set<string>(), all = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const page = await sources.tasks(target.id, after);
    if (!page.length) break;
    if (page.length > 200) throw precondition('会话原项目任务分页超过限制');
    for (const raw of page) {
      const id = TaskIdSchema.parse(raw);
      if (after !== null && id <= after) throw precondition('会话原项目任务分页没有前进');
      after = id; all.add(id);
    }
  }
  const union = sql.join([...SESSION_CONTENT.map((name) => sql`SELECT task_id AS task_key FROM ${sql.raw('session.' + name)}`), sql`SELECT task_key FROM session.connection_births`], sql` UNION `);
  after = null;
  for (;;) {
    const rows: { task_key: string }[] = await db.execute(sql`SELECT task_key FROM (${union}) contents ${after === null ? sql`` : sql`WHERE task_key>${after}`} ORDER BY task_key COLLATE "C" LIMIT 200`);
    if (!rows.length) break;
    for (const row of rows) { all.add(row.task_key); after = row.task_key; }
  }
  const origins = [];
  for (const key of [...all].sort()) {
    const source = await readSessionTask(sources, key);
    const registered = (await db.execute<{ task_id: string; project_id: string | null; identity: string }>(sql`SELECT task_id,project_id,identity FROM session.task_origins WHERE task_key=${key}`))[0];
    if (registered && (registered.task_id !== source.id || registered.project_id !== source.projectId || registered.identity !== source.identity)) throw precondition('会话原任务目录与当前完整来源不符');
    if (source.projectId === target.id) { own.add(key); origins.push(source); }
  }
  return { keys: [...own].sort(), origins };
}

/** Hash all private columns in the database; only minimum identities, counts and digests leave this adapter. */
export async function inspectSessionDeletion(db: Executor, sources: SessionDeletionSources, target: ProjectDeletionTarget) {
  await registeredSessionContent(db);
  const { keys, origins } = await taskKeys(db, sources, target), resources = [];
  const selected = sql.join(keys.map((key) => sql`${key}`), sql`,`);
  if (keys.length) for (const table of SESSION_CONTENT) {
    const body = table === 'connections' ? sql`to_jsonb(content)-'last_seen_at'` : sql`to_jsonb(content)`;
    const rows = await db.execute<{ id: string; count: string; identity: string }>(sql`SELECT task_id AS id,count(*)::text AS count,
      encode(sha256(convert_to(string_agg(session.digest(${body}),',' ORDER BY session.digest(${body})),'UTF8')),'hex') AS identity
      FROM ${sql.raw('session.' + table)} content WHERE task_id IN(${selected}) GROUP BY task_id ORDER BY task_id COLLATE "C"`);
    resources.push(...rows.map((row) => ({ kind: table, id: row.id, identity: row.identity, count: Number(row.count), scope: 'metadata' as const })));
  }
  const original = keys.length ? await db.execute<{ id: string; task_key: string; replica: string; connected_at: Date; exit_key_hash: string; identity: string; original_process: unknown }>(sql`
    SELECT id,task_key,replica,connected_at,exit_key_hash,identity,original_process FROM session.connection_births WHERE task_key IN(${selected}) ORDER BY id COLLATE "C"`) : [];
  const births = original.map((row) => {
    const birth = SessionBirthSchema.parse({ id: row.id, taskId: row.task_key, replica: row.replica, at: new Date(row.connected_at).toISOString(), exitKeyHash: row.exit_key_hash, identity: row.identity,
      ...(row.original_process !== null ? { process: row.original_process } : {}) });
    const { identity, ...material } = birth;
    if (identity !== jsonHash(material)) throw precondition('会话原出生摘要不符');
    return birth;
  });
  resources.push(...births.map((row) => ({ kind: 'original-connection', id: row.id, identity: row.identity, count: 1, scope: 'metadata' as const })));
  if (keys.length && (await db.execute(sql`SELECT task_id FROM session.connections c WHERE task_id IN(${selected})
    AND NOT EXISTS(SELECT 1 FROM session.connection_births b WHERE b.id=c.consumer_id AND b.task_key=c.task_id AND b.replica=c.replica AND b.connected_at=c.connected_at)`)).length)
    throw precondition('会话仍有缺少原出生证明的旧连接，不能据离线推断退出');
  const digest = jsonHash({ origins, births, resources });
  const scope = SessionDeletionScopeSchema.parse({ taskKeys: keys, births, digest, count: resources.reduce((n, row) => n + row.count, 0), compacted: false });
  const inventory = ProjectDeletionInventorySchema.parse({ participant: 'session', complete: true, resources, references: [], blockers: [], revision: digest });
  return { inventory, scope };
}

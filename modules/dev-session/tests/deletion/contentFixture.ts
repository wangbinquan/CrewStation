import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentContentSnapshot } from '../../adapters/persistence/deletion/inspection';
import type { DevelopmentDeletionOrigin } from '../../domain/deletion/content';
import type { DevelopmentDeletionSources } from '../../ports/deletion/sources';
import { devSessionMigrations } from '../../wiring';

/** Actual owner PostgreSQL; public origin ports are controlled identity witnesses, not physical stop evidence. */
export async function developmentContentFixture(options: { legacyOnly?: boolean } = {}) {
  const database = await createTestDatabase([options.legacyOnly ? { ...devSessionMigrations,
    files: devSessionMigrations.files.filter((file) => !/^001[56]_/.test(file.name)) } : devSessionMigrations]);
  const project = ProjectIdSchema.parse(newResourceId()), otherProject = ProjectIdSchema.parse(newResourceId());
  const workspace = TaskIdSchema.parse(newResourceId()), otherWorkspace = TaskIdSchema.parse(newResourceId());
  const origins = new Map<string, DevelopmentDeletionOrigin>(), unavailable = new Set<string>(), requests: string[] = [];
  const bind = (kind: 'project' | 'task' | 'cluster-operation', id: string, projectId = project) => {
    const origin: DevelopmentDeletionOrigin = { complete: true, id, scope: 'project', projectIds: [projectId], revision: jsonHash({ kind, id, projectId }) };
    origins.set(kind + ':' + id, origin); return origin;
  };
  bind('task', workspace); bind('task', otherWorkspace, otherProject); bind('project', project); bind('project', otherProject, otherProject);
  const sources: DevelopmentDeletionSources = { resolve: async (kind, key, representation) => {
    const name = kind + ':' + key; requests.push(name + ':' + representation);
    if (unavailable.has(name)) throw new Error('original source offline');
    return origins.get(name);
  } };
  const agent = async (parent = workspace, id = TaskIdSchema.parse(newResourceId())) => {
    const agentId = newResourceId();
    await database.db.execute(sql`INSERT INTO dev_session.agent_starts(agent_id,task_id,created_by,compute,profile,permission,request,execution,execution_task_id,state,created_at)
      VALUES(${agentId},${parent},${newResourceId()},${newResourceId()},'{"private":"profile"}','default','{"private":"prompt"}',
      ${JSON.stringify({ taskId: id, private: 'execution-private' })}::jsonb,${id},'ended','2026-10-01T00:00:00.000Z')`);
    return { agentId, id, parent };
  };
  const native = async (parent = workspace, id: string | null = newResourceId()) => {
    const agentId = newResourceId(), record = { agentId, terminalId: newResourceId(), runnerId: newResourceId(), private: 'terminal-private' };
    await database.db.execute(sql`INSERT INTO dev_session.native_terminal_starts(agent_id,task_id,created_by,client_request_id,fingerprint,input,record,execution,execution_task_id)
      VALUES(${agentId},${parent},${newResourceId()},${newResourceId()},${jsonHash('request')},'{"private":"native-input"}',${JSON.stringify(record)}::jsonb,
        ${id === null ? null : JSON.stringify({ taskId: id, finalized: true, private: 'native-execution-private' })}::jsonb,${id})`);
    return { agentId, id, parent, record };
  };
  return { database, project, otherProject, workspace, otherWorkspace, origins, unavailable, requests, bind, sources, agent, native,
    inspect: () => developmentContentSnapshot(database.db, sources, project) };
}
export type DevelopmentContentFixture = Awaited<ReturnType<typeof developmentContentFixture>>;

export async function seedDevelopmentContent(f: DevelopmentContentFixture) {
  const cli = await f.native(), headless = await f.agent(), operation = newResourceId(), reserved = newResourceId(), event = newResourceId();
  f.bind('cluster-operation', operation);
  await f.database.db.execute(sql`INSERT INTO dev_session.idle_reminders(task_id,last_reminder_at) VALUES(${f.workspace},now())`);
  await f.database.db.execute(sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout) VALUES(${f.workspace},${newResourceId()},1,'{"private":"layout"}')`);
  await f.database.db.execute(sql`INSERT INTO dev_session.native_activity_progress(task_id,through_seq) VALUES(${f.workspace},1)`);
  await f.database.db.execute(sql`INSERT INTO dev_session.native_activity_states(task_id,agent_id,projection)
    VALUES(${f.workspace},${cli.agentId},${JSON.stringify({ state: { agentId: cli.agentId, private: 'projection-private' } })}::jsonb)`);
  await f.database.db.execute(sql`INSERT INTO dev_session.native_activity_items(task_id,seq,event_id,agent_id,kind,item)
    VALUES(${f.workspace},1,${event},${cli.agentId},'turn-completed',${JSON.stringify({ agentId: cli.agentId, eventId: event, private: 'activity-private' })}::jsonb)`);
  await f.database.db.execute(sql`INSERT INTO dev_session.native_activity_reads(task_id,user_id,agent_id,turn_id,through_seq)
    VALUES(${f.workspace},${newResourceId()},${cli.agentId},'original-turn',1)`);
  await f.database.db.execute(sql`INSERT INTO dev_session.native_activity_sources(task_id,source_task_id,through_seq)
    VALUES(${f.workspace},${cli.id},1)`);
  await f.database.db.execute(sql`INSERT INTO dev_session.comparison_references(id,task_id,runner_comparison_id,target,deployment,created_at)
    VALUES(${newResourceId()},${f.workspace},'private-comparison','production','private-deployment',now())`);
  await f.database.db.execute(sql`INSERT INTO dev_session.cluster_agent_restarts(operation_id,agent_id,task_id) VALUES(${operation},${newResourceId()},${reserved})`);
  const identity = { projectId: f.project, taskId: f.workspace, agentId: headless.agentId, executionId: headless.id };
  await f.database.db.execute(sql`INSERT INTO dev_session.development_agent_usage(execution_task_id,project_id,workspace_task_id,accepted_at,prepared)
    VALUES(${headless.id},${f.project},${f.workspace},'2026-10-01T00:00:00.000Z',${JSON.stringify({ intent: { identity }, private: 'usage-private' })}::jsonb)`);
  await f.database.db.execute(sql`INSERT INTO dev_session.development_agent_endings(execution_task_id,first_reason,observed_at,version,fence,last_attempt_at,stage)
    VALUES(${headless.id},'completed','2026-10-01T00:01:00.000Z',1,0,'2026-10-01T00:01:00.000Z','awaiting-stop')`);
  return { cli, headless, operation, reserved };
}

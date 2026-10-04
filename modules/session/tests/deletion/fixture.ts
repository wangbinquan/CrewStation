import type { ProjectDeletionContext, ProjectDeletionTarget, ProjectId, RunnerHello, TaskId } from '@crewstation/contracts';
import { ProjectIdSchema, ServiceIdSchema, TASKRUNNER_PROTOCOL_VERSION, TaskIdSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import type { MigrationSet } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { SessionCallbackProcesses, SessionDeletionSources, SessionTaskOrigin } from '../../ports/projectDeletion';
import type { SessionModule } from '../../wiring';
import { createSessionModule, sessionMigrations } from '../../wiring';
import { loopbackRequest } from './request';

type SocketData = Parameters<SessionModule['websocket']['message']>[0]['data'];

export async function sessionDeletionFixture(processes?: SessionCallbackProcesses, migrations: MigrationSet = sessionMigrations) {
  const database = await createTestDatabase([migrations]);
  const projectId = ProjectIdSchema.parse(newResourceId()), otherProject = ProjectIdSchema.parse(newResourceId()), operationId = newResourceId();
  const target: ProjectDeletionTarget = { id: projectId, slug: 'delete-session', name: 'Session cleanup', namespace: 'cs-delete-session',
    serviceId: ServiceIdSchema.parse(newResourceId()), kind: 'DigitalWorker', state: 'active', revision: '1',
    prodHost: 'delete-session.test.invalid', previewHost: 'preview.delete-session.test.invalid', serviceHost: 'delete-session.service.test.invalid' };
  const origins = new Map<string, SessionTaskOrigin>();
  let permitted = true, closing = false;
  const task = (project: ProjectId | null = projectId) => {
    const id = TaskIdSchema.parse(newResourceId());
    origins.set(id, { id, complete: true, scope: project === null ? 'platform' : 'project', projectIds: project === null ? [] : [project], revision: jsonHash({ id, project }) });
    return id;
  };
  const source: SessionDeletionSources = {
    processes,
    resolve: async (key) => origins.get(key),
    tasks: async (id, after) => [...new Set([...origins.values()].filter((origin) => origin.projectIds.includes(id) && (after === null || origin.id > after)).map((origin) => origin.id))].sort().slice(0, 200),
    assertAvailable: async (id) => { if (id === projectId && closing) throw precondition('project deleting'); },
    assertGrant: async (context) => { if (!permitted || context.operationId !== operationId || context.target.id !== projectId) throw precondition('grant unavailable'); },
  };
  const servers: ReturnType<typeof Bun.serve<SocketData>>[] = [];
  const replica = () => {
    const server = Bun.serve<SocketData>({ port: 0, fetch: () => new Response('initializing', { status: 503 }), websocket: { message: () => {} } });
    servers.push(server);
    const address = `http://127.0.0.1:${server.port}`;
    const module = createSessionModule({ db: database.db, deletionSources: source, deletionRequest: loopbackRequest,
      runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId }) }, taskAccess: { canOpenStream: async () => true,
        onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, isAdmin: async () => true,
      settings: { selfAddress: address, commandTimeoutMs: 10_000, runnerStaleMs: 30_000, replayLimit: 100 } });
    const app = createApp({ name: 'session-deletion-test' });
    app.route('/', module.http.runner); app.route('/', module.http.stream); app.route('/', module.http.internal);
    server.reload({ fetch: app.fetch, websocket: module.websocket });
    return { module, address, server };
  };
  const first = replica(), second = replica();
  const context = async (): Promise<ProjectDeletionContext> => ({ operationId, generation: 1, target, phase: 'seal', confirmed: await first.module.api.deletionOwner!.inspect(target) });
  const seed = async (id: TaskId, count = 1) => {
    await database.db.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event,legacy_event) SELECT ${id},i,now(),'agent',jsonb_build_object('private','event payload'),jsonb_build_object('private','legacy payload') FROM generate_series(1,${count}) i`);
    await database.db.execute(sql`INSERT INTO session.business_executions(task_id,execution_id,receipt) VALUES(${id},'execution','{"private":"receipt"}')`);
    await database.db.execute(sql`INSERT INTO session.business_execution_events(task_id,execution_id,sequence,digest,event) VALUES(${id},'execution',1,${jsonHash('event')},'{"private":"output"}')`);
    await database.db.execute(sql`INSERT INTO session.business_usage_sources(task_id,execution_id,attempt,incarnation,payload_digest) VALUES(${id},'execution',1,'original',${jsonHash('usage')})`);
    await database.db.execute(sql`INSERT INTO session.business_usage_events(task_id,execution_id,sequence,agent_id,occurred_at,capture) VALUES(${id},'execution',1,'agent','2026-10-03T00:00:00Z','{"private":"usage"}')`);
    await database.db.execute(sql`INSERT INTO session.business_stopped_executions(task_id,execution_id) VALUES(${id},'execution')`);
    await database.db.execute(sql`INSERT INTO session.execution_completion_proofs(task_id,execution_id,record) VALUES(${id},'execution','{"private":"completion"}')`);
    await database.db.execute(sql`INSERT INTO session.development_usage_streams(task_id,registration) VALUES(${id},'{"private":"registration"}')`);
    await database.db.execute(sql`INSERT INTO session.development_usage_events(task_id,sequence,digest,event) VALUES(${id},1,${jsonHash('development')},'{"private":"development"}')`);
  };
  const drop = async () => {
    for (const server of servers) server.stop(true);
    const deadline = Date.now() + 3000;
    while ((await database.db.execute('SELECT id FROM session.connection_births WHERE exited_at IS NULL')).length && Date.now() < deadline) await Bun.sleep(10);
    await database.drop();
  };
  return { database, projectId, otherProject, target, operationId, task, origins, source, first, second, context, seed, drop,
    permit: (value: boolean) => { permitted = value; }, deleting: (value = true) => { closing = value; } };
}

export async function openRunner(address: string, taskId: TaskId, capabilities: Partial<RunnerHello['capabilities']> = {}) {
  const ws = new WebSocket(address.replace('http:', 'ws:') + '/runner'), opened = Promise.withResolvers<void>(), closed = Promise.withResolvers<void>();
  const frames: Record<string, unknown>[] = [], waiters: { test: (frame: Record<string, unknown>) => boolean; resolve: (frame: Record<string, unknown>) => void }[] = [];
  ws.onopen = () => opened.resolve(); ws.onerror = () => opened.reject(new Error('runner socket failed')); ws.onclose = () => closed.resolve();
  ws.onmessage = (event) => { const frame = JSON.parse(String(event.data)); frames.push(frame); for (const waiter of [...waiters]) if (waiter.test(frame)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame); } };
  const next = (match: (frame: Record<string, unknown>) => boolean) => {
    const existing = frames.find(match); if (existing) return Promise.resolve(existing);
    return new Promise<Record<string, unknown>>((resolve) => { waiters.push({ test: match, resolve }); });
  };
  await opened.promise;
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: 'private runner token', workdir: '/private-work',
    capabilities: { protocols: ['terminal'], pty: true, preview: false, ...capabilities } }));
  await next((frame) => frame.type === 'welcome');
  return { ws, frames, next, closed: closed.promise };
}

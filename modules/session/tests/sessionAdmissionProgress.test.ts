// 2026-10-07 real r3 failure: four Session hellos held the entire original
// guard pool while their TaskRuntime authentication needed another guard.
// This test uses real PostgreSQL, the real Session router and real WebSockets;
// the controlled TaskRuntime port reproduces the deployed owner-lock topology.
import { describe, expect, test } from 'bun:test';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { noopLogger, systemClock } from '@crewstation/kernel';
import { sessionConnectionHistory } from '../adapters/persistence/deletion/lifetime';
import { drizzleConnectionRegistry, drizzleRunnerEventStore } from '../adapters/persistence/drizzleRepositories';
import { runnerHub } from '../application/runnerHub';
import type { SessionConnectionBirth, SessionConnectionHistory } from '../ports/projectDeletion';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createSessionModule } from '../wiring';
import type { SessionModule } from '../wiring';
import { openRunner, sessionDeletionFixture } from './deletion/fixture';

type SocketData = Parameters<SessionModule['websocket']['message']>[0]['data'];

const available = await testDatabaseAvailable();

async function withinOriginalBudget<T>(pending: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 10_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function originalHelloFixture(count: number, hold?: Promise<void>, onConnected?: () => Promise<void>) {
  const f = await sessionDeletionFixture(), admitted = Promise.withResolvers<void>();
  let arrivals = 0;
  const ready = new Map<string, Promise<void>>();
  const server = Bun.serve<SocketData>({ port: 0, fetch: () => new Response('initializing', { status: 503 }), websocket: { message: () => {} } });
  const address = `http://127.0.0.1:${server.port}`;
  const module = createSessionModule({ db: f.database.db, deletionSources: f.source,
    runnerAuth: { verifyRunnerToken: async () => {
      if (++arrivals === count) admitted.resolve();
      await admitted.promise; await hold;
      return withSharedDatabaseAdmission(f.database.db, 'task-runtime.project-admission:' + f.projectId,
        async (tx) => { await tx.execute(sql`SELECT 1`); return { ok: true as const, projectId: f.projectId }; });
    } },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () =>
      withSharedDatabaseAdmission(f.database.db, 'task-runtime.project-admission:' + f.projectId,
        async (tx) => { await onConnected?.(); await tx.execute(sql`SELECT 1`); return true; }), onRunnerDisconnected: async () => {},
      onRunnerReady: (taskId) => {
        const pending = withSharedDatabaseAdmission(f.database.db, 'task-runtime.project-admission:' + f.projectId,
          async (tx) => { await tx.execute(sql`SELECT 1`); }).then(() => undefined);
        ready.set(taskId, pending); void pending.catch(() => undefined);
      } },
    isAdmin: async () => true,
    settings: { selfAddress: address, commandTimeoutMs: 10_000, runnerStaleMs: 30_000, replayLimit: 100 },
  });
  const app = createApp({ name: 'session-admission-progress' });
  app.route('/', module.http.runner); app.route('/', module.http.stream); app.route('/', module.http.internal);
  server.reload({ fetch: app.fetch, websocket: module.websocket });
  const drop = async () => {
    // Release only this isolated test database's original guards on a red case.
    // Production admissions, pool sizes and timeout protection remain intact.
    await f.database.db.execute(sql`SELECT pg_terminate_backend(l.pid) FROM pg_locks l
      WHERE l.locktype='advisory' AND l.granted AND l.mode='ShareLock'
      AND l.classid=((hashtextextended(${'session.project-admission:' + f.projectId},0)>>32)&4294967295)::oid
      AND l.objid=(hashtextextended(${'session.project-admission:' + f.projectId},0)&4294967295)::oid`);
    // Match the original fixture: stop accepting connections immediately,
    // then await Session's real callbacks and database cleanup. Bun 1.3's
    // force-stop Promise can remain pending after a rejected hello closes.
    void server.stop(true); await module.workers[0]!.stop(); await f.drop();
  };
  return { f, module, address, admitted: admitted.promise, ready, drop };
}

async function originalBirthRejectionFixture(pauseBirth: boolean) {
  const f = await sessionDeletionFixture(), task = f.task();
  const born = Promise.withResolvers<SessionConnectionBirth>(), release = Promise.withResolvers<void>(), rejected = Promise.withResolvers<void>();
  const original = sessionConnectionHistory(f.database.db, f.source);
  const history: SessionConnectionHistory = { ...original,
    birth: async (input) => {
      const birth = await original.birth(input); born.resolve(birth);
      if (pauseBirth) await release.promise;
      return birth;
    },
    open: (id, work) => original.open(id, async () => {
      const result = await work(); if (!pauseBirth) await release.promise; return result;
    }).catch((error: unknown) => { rejected.resolve(); throw error; }),
  };
  const frames: Record<string, unknown>[] = [];
  let closed = false, ready = false;
  const hub = runnerHub({ connectionHistory: history, registry: drizzleConnectionRegistry(f.database.db),
    events: drizzleRunnerEventStore(f.database.db), logger: noopLogger, clock: systemClock,
    settings: { selfAddress: f.first.address, commandTimeoutMs: 10_000, runnerStaleMs: 30_000, replayLimit: 100 },
    forwarder: { forward: async () => { throw new Error('unexpected forward'); } },
    runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: f.projectId }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => true,
      onRunnerDisconnected: async () => {}, onRunnerReady: () => { ready = true; } },
  });
  const sink = { send: (frame: string) => frames.push(JSON.parse(frame)), close: () => { closed = true; } };
  const hello = { type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: task,
    runnerToken: 'private runner token', workdir: '/private-work', capabilities: { protocols: ['terminal'], pty: true, preview: false } };
  return { f, task, hub, sink, hello, born: born.promise, rejected: rejected.promise, release, frames,
    closed: () => closed, ready: () => ready };
}

describe.skipIf(!available)('Session original handshake admission progress', () => {
  test('four concurrent real hellos finish nested TaskRuntime authentication without exhausting the original four guard slots', async () => {
    const g = await originalHelloFixture(4), tasks = Array.from({ length: 4 }, () => g.f.task());
    try {
      const runners = await withinOriginalBudget(Promise.all(tasks.map((task) => openRunner(g.address, task))), 'four original hellos could not reach welcome');
      expect(runners.every((runner) => runner.frames.some((frame) => frame.type === 'welcome'))).toBe(true);
      const births = await g.f.database.db.execute<{ task_id: string }>(sql`SELECT task_key AS task_id FROM session.connection_births WHERE exited_at IS NULL ORDER BY task_id`);
      expect(births.map((birth) => birth.task_id)).toEqual([...tasks].sort());
      for (const task of tasks) expect(await g.module.api.connectionStatus(task)).toMatchObject({ connected: true });
      expect([...g.ready.keys()].sort()).toEqual([...tasks].sort());
      await withinOriginalBudget(Promise.all(g.ready.values()), 'original ready callbacks inherited an ended Session guard');
      const at = new Date().toISOString(), first = runners[0]!;
      first.ws.send(JSON.stringify({ type: 'event', seq: 1, at, event: { kind: 'agent', event: { agentId: 'original', seq: 1, at, type: 'text', text: 'original event' } } }));
      const pending = g.module.api.sendCommand(tasks[0]!, { id: 'after-hello', type: 'previewStatus' });
      await withinOriginalBudget(first.next((frame) => frame.id === 'after-hello'), 'original command did not reach Runner');
      first.ws.send(JSON.stringify({ type: 'result', id: 'after-hello', payload: { state: 'ready' } }));
      expect(await withinOriginalBudget(pending, 'original command reply did not finish')).toEqual({ state: 'ready' });
      expect((await g.module.api.listEvents(tasks[0]!, {})).map((event) => event.seq)).toEqual([1]);
      for (const runner of runners) runner.ws.close();
    } finally { await g.drop(); }
  }, 25_000);

  test('shutdown waits for the original pending authentication and leaves no accepted connection after that callback exits', async () => {
    const release = Promise.withResolvers<void>(), g = await originalHelloFixture(1, release.promise), task = g.f.task();
    // Keep the real client even when hello is rejected; openRunner waits for
    // welcome and cannot return its socket for cleanup in this shutdown case.
    const ws = new WebSocket(g.address.replace('http:', 'ws:') + '/runner');
    const opened = Promise.withResolvers<void>(), closed = Promise.withResolvers<void>(), frames: Record<string, unknown>[] = [];
    ws.onopen = () => opened.resolve(); ws.onerror = () => opened.reject(new Error('runner socket failed'));
    ws.onclose = () => closed.resolve(); ws.onmessage = (event) => frames.push(JSON.parse(String(event.data)));
    let stopped = false;
    try {
      await withinOriginalBudget(opened.promise, 'original client did not open');
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: task, runnerToken: 'private runner token', workdir: '/private-work',
        capabilities: { protocols: ['terminal'], pty: true, preview: false } }));
      await withinOriginalBudget(g.admitted, 'original hello did not enter authentication');
      const stopping = g.module.workers[0]!.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      release.resolve(); await withinOriginalBudget(stopping, 'shutdown did not drain original hello');
      expect(await g.module.api.connectionStatus(task)).toMatchObject({ connected: false });
      expect(await g.f.database.db.execute(sql`SELECT id FROM session.connection_births WHERE exited_at IS NULL`)).toHaveLength(0);
      expect(frames.some((frame) => frame.type === 'welcome')).toBe(false);
      expect(g.ready.size).toBe(0);
    } finally { release.resolve(); ws.close(); await withinOriginalBudget(closed.promise, 'original client did not close'); await g.drop(); }
  }, 25_000);
  test('shutdown retains and retires both original births when an admitted TaskRuntime handshake is still pending', async () => {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let connected = 0;
    const g = await originalHelloFixture(1, undefined, async () => { if (++connected === 2) { entered.resolve(); await release.promise; } });
    const task = g.f.task(), first = await openRunner(g.address, task);
    const originalReady = g.ready.get(task);
    const ws = new WebSocket(g.address.replace('http:', 'ws:') + '/runner');
    const opened = Promise.withResolvers<void>(), closed = Promise.withResolvers<void>(), frames: Record<string, unknown>[] = [];
    ws.onopen = () => opened.resolve(); ws.onerror = () => opened.reject(new Error('runner socket failed'));
    ws.onclose = () => closed.resolve(); ws.onmessage = (event) => frames.push(JSON.parse(String(event.data)));
    let stopped = false;
    try {
      await withinOriginalBudget(opened.promise, 'original reconnect client did not open');
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: task, runnerToken: 'private runner token', workdir: '/private-work',
        capabilities: { protocols: ['terminal'], pty: true, preview: false } }));
      await withinOriginalBudget(entered.promise, 'original admitted TaskRuntime callback did not enter');
      const stopping = g.module.workers[0]!.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      release.resolve(); await withinOriginalBudget(stopping, 'shutdown did not drain original admitted reconnect');
      const births = await g.f.database.db.execute(sql`SELECT id,exited_at FROM session.connection_births WHERE task_key=${task} ORDER BY id`);
      expect(births).toHaveLength(2); expect(births.every((birth) => birth['exited_at'] !== null)).toBe(true);
      expect(await g.module.api.connectionStatus(task)).toMatchObject({ connected: false });
      expect(frames.some((frame) => frame.type === 'welcome')).toBe(false);
      expect(g.ready.get(task)).toBe(originalReady);
      expect(await g.f.database.db.execute(sql`SELECT id FROM session.connection_births WHERE exited_at IS NULL`)).toHaveLength(0);
    } finally { release.resolve(); first.ws.close(); ws.close(); await withinOriginalBudget(closed.promise, 'original reconnect client did not close'); await g.drop(); }
  }, 25_000);
  for (const pauseBirth of [false, true]) {
    test(`real rejected guard retires the durable original birth (${pauseBirth ? 'issued birth still settling' : 'birth returned before guard commit'})`, async () => {
      const g = await originalBirthRejectionFixture(pauseBirth);
      let finished = false;
      const retiring = g.hub.onHello(g.hello, g.sink).then((result) => { finished = true; return result; },
        (error: unknown) => { finished = true; return error; });
      try {
        const birth = await withinOriginalBudget(g.born, 'original durable birth did not commit');
        const row = (await g.f.database.db.execute<{ backend_pid: number; exited_at: unknown }>(
          sql`SELECT backend_pid,exited_at FROM session.connection_births WHERE id=${birth.id}`))[0]!;
        expect(row.exited_at).toBeNull();
        expect((await g.f.database.db.execute<{ terminated: boolean }>(sql`SELECT pg_terminate_backend(${row.backend_pid}) AS terminated`))[0]!.terminated).toBe(true);
        await withinOriginalBudget(g.rejected, 'original guard did not actually reject');
        await g.f.database.db.execute(sql`SELECT 1`);
        if (pauseBirth) { expect(finished).toBe(false); expect(g.closed()).toBe(false); }
        g.release.resolve();
        expect(await withinOriginalBudget(retiring, 'original private finally did not drain')).toBeInstanceOf(Error);
        expect(g.closed()).toBe(true); expect(g.frames.some((frame) => frame.type === 'welcome')).toBe(false); expect(g.ready()).toBe(false);
        expect(g.hub.connections.has(g.task)).toBe(false);
        const exited = (await g.f.database.db.execute<{ exited_at: unknown; exit_digest: string }>(
          sql`SELECT exited_at,exit_digest FROM session.connection_births WHERE id=${birth.id}`))[0]!;
        expect(exited.exited_at).not.toBeNull(); expect(exited.exit_digest).toBe(birth.identity);
        expect(await g.f.database.db.execute(sql`SELECT task_id FROM session.connections WHERE task_id=${g.task}`)).toHaveLength(0);
      } finally { g.release.resolve(); await retiring; await g.hub.shutdown(); await g.f.drop(); }
    }, 25_000);
  }

});

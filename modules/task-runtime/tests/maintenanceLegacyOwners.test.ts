// RFC-034: actual PG and the existing independent K8s fixture; no external model/resource operation.
import { afterEach, describe, expect, test } from 'bun:test';
import { LaunchSpecSchema, ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { RunnerEvent } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { PROFILE_TEST_PROJECT_ID } from '../domain/profileTestEnvironment';
import { resourceEndingHandler } from '../application/development/parent/retention';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';
import type { DevelopmentWorkloadFixture } from './developmentWorkloadFixture';
import { corruptRuntimeContent } from './deletion/contentFixture';

const available = await testDatabaseAvailable();
const rates = ['rate-limit-user', 'rate-limit-host'];
describe.skipIf(!available)('actual maintenance legacy owners and original presence (real PG)', () => {
  let f: DevelopmentWorkloadFixture;
  afterEach(async () => { await f?.close(); });
  async function snapshot(id: string) {
    const record = (await f.resources.api.get(id))!;
    return { id: record.id, projectId: record.projectId ?? null, owner: record.owner, kind: record.kind,
      generation: record.generation, version: record.version, retainUntil: record.retainUntil?.toISOString() ?? null,
      phaseSince: record.phaseSince.toISOString(), specHash: jsonHash(record.spec) };
  }
  const inspect = async (id: string, step: 'compaction' | 'retention' = 'compaction') =>
    f.runtime.api.inspectResourceEnding!(step, await snapshot(id));

  test('SQL NULL is genuine absence; false/null/scalar/array owner material never becomes legacy absence', async () => {
    f = await developmentWorkloadFixture('ledger');
    expect(f.parent.render).toBeUndefined(); expect(f.parent.native).toBeUndefined();
    expect(await inspect(f.parent.id)).toEqual({ status: 'unselected' });
    for (const column of ['render', 'native']) {
      for (const value of [false, null, 0, 'bad-material', []]) {
        await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET ${sql.identifier(column)}=${JSON.stringify(value)}::jsonb WHERE id=${f.parent.id}`);
        expect(await inspect(f.parent.id)).toMatchObject({ status: 'waiting' });
      }
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET ${sql.identifier(column)}=NULL WHERE id=${f.parent.id}`);
      expect(await inspect(f.parent.id)).toEqual({ status: 'unselected' });
    }
  });

  function profileRuntime() {
    const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
    return f.replace({ creation: undefined,
      testRunner: {
        sendCommand: async (taskId, command) => {
          if (command.type === 'exec') return { execId: command.execId, exitCode: 0, stdout: 'opencode 1.18.29\n', stderr: '', durationMs: 3, truncated: false };
          if (command.type === 'startAgent') {
            const at = new Date().toISOString();
            const rows = [
              { kind: 'agent', event: { agentId: command.agentId, seq: 1, at, type: 'started' } },
              { kind: 'agent', event: { agentId: command.agentId, seq: 2, at, type: 'session', sessionId: 'maintenance-profile-test' } },
              { kind: 'agent', event: { agentId: command.agentId, seq: 3, at, type: 'text', text: 'maintenance-ok' } },
              { kind: 'agent', event: { agentId: command.agentId, seq: 4, at, type: 'completed', result: { exitCode: 0 } } },
            ] satisfies RunnerEvent[];
            events.set(taskId, rows.map((event, n) => ({ seq: n + 1, at, event })));
          }
          return {};
        },
        listEvents: async (id, page) => (events.get(id) ?? []).filter(row => row.seq > (page?.sinceSeq ?? 0)),
        connectionStatus: async () => ({ connected: true }),
      }, testTiming: { pollMs: 5, connectTimeoutMs: 1500, modelBudgetMs: 1500, disconnectGraceMs: 100 } });
  }
  async function runProfile(runtime: ReturnType<typeof profileRuntime>) {
    const profile = f.profiles[0]!.id;
    return runtime.api.runProfileTest({ testId: Bun.randomUUIDv7(), profile, revision: 1,
      launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode' }), image: 'task:current',
      beforeStart: { profile, revision: 1, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: true },
      prompt: 'maintenance-ok', expectedReply: 'maintenance-ok' }, async progress => {
      if (!progress.context?.taskId) return;
      const id = TaskIdSchema.parse(progress.context.taskId), env = await f.load(id);
      if (env.connected || env.state !== 'creating') return;
      const pod = (await f.k8s.get(Resources.Pod!, env.podName, env.namespace))!;
      const token = (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find(v => v.name === 'CS_RUNNER_TOKEN')!.value;
      await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Running', containerStatuses: [{ name: 'task', imageID: 'task:current' }] } });
      expect(await runtime.api.onRunnerConnected(id, token)).toBe(true);
    }, async () => true);
  }

  test('public platform profile-test uses its sentinel lock and remains eligible for legacy compaction and failed retention', async () => {
    f = await developmentWorkloadFixture('native');
    const runtime = profileRuntime();
    expect(await runProfile(runtime)).toMatchObject({ state: 'passed' });
    const completed = (await f.uow.read.environments.listByProject(PROFILE_TEST_PROJECT_ID, ['released']))[0]!;
    expect(completed.kind).toBe('profile-test');
    const original = await snapshot(completed.id); expect(original.projectId).toBeNull();
    expect(await inspect(completed.id)).toEqual({ status: 'unselected' });
    expect(await runtime.api.inspectResourceEnding!('compaction', { ...original, projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()) })).toMatchObject({ status: 'waiting' });
    const validation = { image: 'task:current', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, start: 1, workVolume: 'emptyDir' };
    for (const value of [false, null, { projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()), usage: 'task', quotaHeld: true }]) {
      await corruptRuntimeContent({ database: f.tdb }, 'environments', () => f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=${JSON.stringify({ ...validation, runtimeValidation: value })}::jsonb WHERE id=${completed.id}`));
      expect(await inspect(completed.id)).toMatchObject({ status: 'waiting' });
    }
    await corruptRuntimeContent({ database: f.tdb }, 'environments', () => f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=NULL WHERE id=${completed.id}`));
    await f.tdb.db.execute(sql`UPDATE resources.records SET phase='stopped',phase_since=clock_timestamp()-interval '8 days' WHERE id=${completed.id}`);
    await f.resources.maintainOnce();
    expect((await f.resources.api.get(completed.id))?.compactedAt).toBeInstanceOf(Date);
    const create = f.k8s.create.bind(f.k8s);
    f.k8s.create = async input => { if (input.kind === 'Pod' && input.metadata.namespace === f.deps.settings.systemNamespace) throw new Error('controlled profile pod create failure'); return create(input); };
    expect(await runProfile(runtime)).toMatchObject({ state: 'failed' });
    const failed = (await f.uow.read.environments.listByProject(PROFILE_TEST_PROJECT_ID, ['failed']))[0]!;
    expect((await snapshot(failed.id)).projectId).toBeNull();
    expect(await inspect(failed.id, 'retention')).toEqual({ status: 'unselected' });
    await f.tdb.db.execute(sql`UPDATE resources.records SET retain_until=clock_timestamp()-interval '1 day' WHERE id=${failed.id}`);
    await f.resources.maintainOnce();
    expect((await f.resources.api.get(failed.id))?.desired).toBe('absent');
  }, 15000);

  test('old owner preview handoff and new ledger preview use the same full formal rate middleware projection', async () => {
    f = await developmentWorkloadFixture('native');
    const create = async () => f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', volumeMode: 'persistent',
      preview: { command: ['bun', 'dev'], port: 3000, healthPath: '/' } });
    const legacy = await create(); expect((await f.load(legacy.id)).render).toBeUndefined();
    const settings = { ...f.deps.settings, previewRateMiddlewares: rates };
    const runtime = f.replace({ creation: 'ledger', settings });
    const resync = runtime.workers.at(-1)!; resync.start(); await resync.stop();
    const fresh = await create();
    for (const id of [legacy.id, fresh.id]) {
      const route = (await f.resources.api.list({ parentId: id, kind: 'route' }))[0]!;
      expect(route.spec.middlewares).toEqual(expect.arrayContaining(rates.map(name => ({ name }))));
      expect((await f.resources.api.get(id))?.children.some(child => child.kind === 'IngressRoute')).toBe(false);
      expect(await inspect(id)).toEqual({ status: 'unselected' });
      expect(await inspect(route.id)).toEqual({ status: 'unselected' });
      const original = await snapshot(route.id);
      expect(await runtime.api.inspectResourceEnding!('compaction', { ...original, specHash: '0'.repeat(64) })).toMatchObject({ status: 'waiting' });
    }

  }, 15000);
  test('preview resolution never holds the Task project lock; every projection input is rechecked after resolution', async () => {
    f = await developmentWorkloadFixture('native');
    const env = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', volumeMode: 'persistent',
      preview: { command: ['bun', 'dev'], port: 3000, healthPath: '/' } });
    const settings = { ...f.deps.settings, previewRateMiddlewares: rates };
    const runtime = f.replace({ creation: 'ledger', settings }), resync = runtime.workers.at(-1)!;
    resync.start(); await resync.stop();
    const original = await f.load(env.id), resolver = f.deps.services.resolveServiceById;
    for (const change of ['labels', 'preview', 'rebuildId']) {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
      f.replace({ creation: 'ledger', settings, services: { resolveServiceById: async id => { entered(); await resume; return resolver(id); } } });
      const call = f.runtime.api.inspectResourceEnding!('compaction', await snapshot(env.id));
      await started;
      try {
        await f.tdb.db.transaction(async tx => { await tx.execute(sql`SELECT project_id FROM task_runtime.admissions WHERE project_id=${f.projectId} FOR UPDATE NOWAIT`); });
        if (change === 'labels') await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET labels=labels||'{"changed":"during-preview-resolution"}'::jsonb WHERE id=${env.id}`);
        if (change === 'preview') await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET preview=${JSON.stringify({ ...original.preview, port: 3001 })}::jsonb WHERE id=${env.id}`);
        if (change === 'rebuildId') await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET rebuild_id=${Bun.randomUUIDv7()} WHERE id=${env.id}`);
      } finally { release(); }
      expect(await call).toMatchObject({ status: 'waiting' });
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET labels=${JSON.stringify(original.labels)}::jsonb,preview=${JSON.stringify(original.preview)}::jsonb,rebuild_id=NULL WHERE id=${env.id}`);
      f.replace({ creation: 'ledger', settings });
      expect(await inspect(env.id)).toEqual({ status: 'unselected' });
    }
  }, 15000);

  test('missing raw owner reader capability waits without inferring absence from the legacy mapper', async () => {
    f = await developmentWorkloadFixture('ledger');
    const handler = resourceEndingHandler({ uow: { ...f.uow, read: { ...f.uow.read, environments: { ...f.uow.read.environments, getMaintenanceView: undefined } } } });
    expect(await handler('compaction', await snapshot(f.parent.id))).toMatchObject({ status: 'waiting' });
  });

  test('actual SQL scalar strings that look like JSON objects/arrays/literals are always malformed owner material', async () => {
    f = await developmentWorkloadFixture('ledger');
    for (const column of ['render', 'native']) for (const text of ['{}', '[]', 'null', 'false', '{"version":1}']) {
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET ${sql.identifier(column)}=${JSON.stringify(text)}::jsonb WHERE id=${f.parent.id}`);
      const rows = await f.tdb.db.execute(sql`SELECT jsonb_typeof(${sql.identifier(column)}) AS kind FROM task_runtime.environments WHERE id=${f.parent.id}`);
      expect(rows[0]?.kind).toBe('string');
      expect(await f.uow.read.environments.getMaintenanceView!(f.parent.id)).toEqual({ status: 'malformed' });
      expect(await inspect(f.parent.id)).toMatchObject({ status: 'waiting' });
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET ${sql.identifier(column)}=NULL WHERE id=${f.parent.id}`);
      expect(await inspect(f.parent.id)).toEqual({ status: 'unselected' });
    }
  });

  test('a scalar string containing the exact public-created valid render cannot obtain legacy maintenance permission', async () => {
    f = await developmentWorkloadFixture('ledger');
    const env = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', volumeMode: 'persistent' });
    const original = await f.load(env.id); expect(original.render).toBeDefined();
    expect(await inspect(env.id)).toEqual({ status: 'unselected' });
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=${JSON.stringify(JSON.stringify(original.render))}::jsonb WHERE id=${env.id}`);
    const rows = await f.tdb.db.execute(sql`SELECT jsonb_typeof(render) AS kind FROM task_runtime.environments WHERE id=${env.id}`);
    expect(rows[0]?.kind).toBe('string');
    expect(await inspect(env.id)).toMatchObject({ status: 'waiting' });
    expect(await f.uow.read.environments.getMaintenanceView!(env.id)).toEqual({ status: 'malformed' });
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=${JSON.stringify(original.render)}::jsonb WHERE id=${env.id}`);
    expect(await inspect(env.id)).toEqual({ status: 'unselected' });
  });

});

import { sql } from 'drizzle-orm';
import { PROFILE_TEST_PROJECT_ID } from '../domain/profileTestEnvironment';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, RunnerCommand, RunnerEvent, TaskId } from '@crewstation/contracts';
import { LaunchSpecSchema, PLATFORM_ENV } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { newResourceId, notFound } from '@crewstation/kernel';
import { createClusterControlModule } from '@crewstation/module-cluster-control';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ProfileTestRunInput } from '../api/moduleApi';
import type { EnvironmentLedger } from '../ports/ledger';
import type { TaskRuntimeModule } from '../wiring';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

// RFC-025 I25 第四步：档位测试的 Pod 也由资源中心建出——受理只登记（临时目录、没有工作卷），Runner 的内容建 Secret 时才要
// （不再以明文环境变量写进系统命名空间的 Pod 规格）；等 Runner 时，记下 Pod 实例之前的「不存在」是还没建出来，不判容器没起来。
const available = await testDatabaseAvailable();
const image = `registry.local:5000/runtime/gw@sha256:${'c'.repeat(64)}`;
const nonce = 'crewstation-test-ledger-7a1c';
const profileId = '01a0bf5d-8f4b-7001-8458-107366e7de39';

describe.skipIf(!available)('档位测试由资源中心建出（RFC-025 I25 第四步）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let runtime: TaskRuntimeModule;
  const k8s = createFakeK8sClient();
  const admissionCalls: string[] = [];
  const warnings: string[] = [];
  const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
  const emit = (taskId: string, event: RunnerEvent) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at: new Date().toISOString(), event }); events.set(taskId, list); };
  const agent = (agentId: string, seq: number, event: Record<string, unknown> & { type: string }): RunnerEvent => ({ kind: 'agent', event: { agentId, seq, at: new Date().toISOString(), ...event } } as RunnerEvent);

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true, projectAvailable: async (id) => { admissionCalls.push(id); throw notFound('项目', id); } });
    const owner = resources.api.owner('task-runtime');
    const ledger: EnvironmentLedger = { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
    runtime = createTaskRuntimeModule({
      db: tdb.db, k8s, authorizer: { authorize: async () => undefined }, quotas: { quotaLimit: async () => 2 }, isAdmin: async () => true, ledger, creation: 'ledger',
      profiles: { listTaskProfiles: async () => [], getTaskProfile: async (id) => (id === profileId ? { id, name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi' } : undefined) },
      // 档位测试不属于任何服务：要值时不该去查服务。
      services: { resolveServiceById: async () => { throw new Error('档位测试不得查询服务'); } },
      sources: { configEnv: async () => { throw new Error('测试任务不得读取项目配置'); }, dataEnv: async () => { throw new Error('测试任务不得读取项目数据'); }, taskDataEnv: async () => ({}) },
      testRunner: {
        sendCommand: async (taskId: string, command: RunnerCommand) => {
          if (command.type === 'exec') return { execId: command.execId, exitCode: 0, stdout: 'opencode 1.18.29\n', stderr: '', durationMs: 3, truncated: false };
          if (command.type === 'startAgent') {
            emit(taskId, agent(command.agentId, 1, { type: 'started' }));
            emit(taskId, agent(command.agentId, 2, { type: 'session', sessionId: 'ses-ledger' }));
            emit(taskId, agent(command.agentId, 3, { type: 'text', text: nonce }));
            emit(taskId, agent(command.agentId, 4, { type: 'completed', result: { exitCode: 0 } }));
          }
          return {};
        },
        listEvents: async (taskId: string, options?: { sinceSeq?: number; kinds?: string[] }) => (events.get(taskId) ?? []).filter((e) => e.seq > (options?.sinceSeq ?? 0) && (!options?.kinds || options.kinds.includes(e.event.kind))),
        connectionStatus: async () => ({ connected: true }),
      },
      testTiming: { pollMs: 20, connectTimeoutMs: 3000, modelBudgetMs: 1500, disconnectGraceMs: 200 },
      settings: { taskImage: 'cs-task-runtime:test', systemNamespace: 'crewstation-system', sessionUrl: 'ws://cs-session:8083/runner', userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', workerUid: 10001, defaultProfile: profileId, userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers' },
    });
  });
  afterAll(async () => { await tdb.drop(); });

  function controller() {
    const ledger = resources.api, objects = () => [...k8s.objects.values()];
    return createClusterControlModule({ k8s, systemNamespace: 'crewstation-system', isAdmin: async () => true, orphanSweep: false,
      legacy: { resolveTaskId: async () => undefined, task: async () => undefined },
      logger: { debug: () => {}, info: () => {}, warn: (message, fields) => { warnings.push(message + ' ' + JSON.stringify(fields)); }, error: () => {}, child() { return this; } },
      reconciler: { pollMs: 10, retryMs: 10, concurrency: 1 },
      ledger: { ...ledger, withProjectAdmission: (id, work) => ledger.projectDeletion.withAdmission(id as ProjectId, work),
        listLive: () => ledger.list({}), children: (parentId) => ledger.list({ parentId, includeStopped: true }), adoptOrphanVolume: async () => {} },
      feed: { start: () => {}, stop: async () => {}, synced: async () => {}, cached: (kind, ns, name) => objects().find((o) => o.kind === kind && o.metadata.namespace === ns && o.metadata.name === name), list: (kind) => objects().filter((o) => o.kind === kind) },
      workloads: { runnerValues: (id) => runtime.api.runnerValues(id as TaskId), checkoutValues: (id) => runtime.api.checkoutValues(id as TaskId),
        bindWorkload: (id, podUid, secretUid) => runtime.api.bindWorkload(id as TaskId, podUid, secretUid), workloadUnavailable: (id, code) => runtime.api.workloadUnavailable(id as TaskId, code) },
    });
  }

  /** RFC-034 真实失败回归：公共调和器、真实 PG 删除准入和 Kubernetes writer，不能手工建 Pod 绕过项目 guard。 */
  async function reconcileOnce(): Promise<{ id: TaskId; spec: Record<string, unknown>; values: Record<string, string> } | undefined> {
    const deadline = Date.now() + 2500;
    let record;
    while (!record && Date.now() < deadline) {
      record = (await resources.api.list({ kind: 'agent-execution' })).find((entry) => entry.conditions.some((c) => c.type === 'Provisioning' && c.status === 'true'));
      if (!record) await Bun.sleep(10);
    }
    if (!record) return undefined;
    await Bun.sleep(150);
    const id = record.id as TaskId, podName = record.spec.children[0]!.name, secretName = (record.spec['pod'] as { secret: string }).secret;
    const control = controller(); control.observer.start();
    try {
      while (!await k8s.get(Resources.Pod!, podName, 'crewstation-system') && Date.now() < deadline) await Bun.sleep(10);
      if (!await k8s.get(Resources.Pod!, podName, 'crewstation-system')) return undefined;
      await control.reconciled();
      const secret = await k8s.get(Resources.Secret!, secretName, 'crewstation-system');
      // 假 API Server 保留标准 writer 的 stringData（真实 API Server 会编码到 data）。
      const values = secret!.stringData as Record<string, string>;
      await k8s.mergePatch(Resources.Pod!, podName, 'crewstation-system', { status: { phase: 'Running', containerStatuses: [{ name: 'task', imageID: image }] } });
      expect(await runtime.api.onRunnerConnected(id, values['CS_RUNNER_TOKEN']!)).toBe(true);
      return { id, spec: record.spec as Record<string, unknown>, values };
    } finally { await control.observer.stop(); }
  }

  test('受理只登记、临时目录不等卷；Pod 建出之前不判没起来；Runner 的内容建的时候才给（平台服务、没有租户配置）；测完释放', async () => {
    const input: ProfileTestRunInput = {
      testId: '01a0bf5d-8f4b-7435-8062-f84a0a1cbb01', profile: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 1, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'anthropic/claude-x' }), image,
      beforeStart: { profile: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 1, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: true },
      prompt: `Output this exact token verbatim and nothing else: ${nonce}`, expectedReply: nonce,
    };
    const run = runtime.api.runProfileTest(input, async () => undefined, async () => true);
    const captured = await reconcileOnce();
    const outcome = await run;
    expect(captured).toBeDefined();
    if (!captured) throw new Error('真实项目准入阻止平台测试建 Pod：' + warnings.join('\n'));
    const { id, spec, values } = captured;
    expect(admissionCalls).toEqual([]);
    expect((await resources.api.get(id))?.projectId).toBeUndefined();
    expect(spec['pod']).toMatchObject({ image, emptyDir: true, workload: 'profile-test', project: 'platform', service: 'profile-test', secret: `${(spec as { children: Array<{ name: string }> }).children[0]!.name}-runner-1` });
    expect(spec['pod']).not.toHaveProperty('pvc');
    expect(values).toMatchObject({ [PLATFORM_ENV.project]: 'platform', [PLATFORM_ENV.service]: 'profile-test' });
    expect(outcome).toMatchObject({ state: 'passed', outcome: 'passed' });
    expect(await runtime.api.getEnvironment(id)).toMatchObject({ kind: 'profile-test', state: 'released' });
    expect((await resources.api.get(id))?.desired).toBe('absent');
    const counters = await tdb.db.execute(sql`SELECT running FROM task_runtime.admissions WHERE project_id=${PROFILE_TEST_PROJECT_ID}`);
    expect(counters[0]?.['running']).toBe(0);
    await runtime.api.releaseEnvironment(id, 'profile-test');
    expect((await tdb.db.execute(sql`SELECT running FROM task_runtime.admissions WHERE project_id=${PROFILE_TEST_PROJECT_ID}`))[0]?.['running']).toBe(0);
  });
  test('平台测试的修复仍保留真实项目存在和闭准入校验，均不建 Pod / Secret', async () => {
    const projectId = newResourceId() as ProjectId, id = newResourceId(), name = 'task-real-project-rejected';
    const original = (await resources.api.list({ kind: 'agent-execution', includeStopped: true }))[0]!;
    await resources.api.owner('task-runtime').declare({ id, ref: id, kind: 'agent-execution', projectId, purpose: 'profile-test',
      conditions: [{ type: 'Provisioning', status: 'true' }], spec: { ...original.spec, children: [{ kind: 'Pod', namespace: 'crewstation-system', name }, { kind: 'Secret', namespace: 'crewstation-system', name: name + '-runner' }], pod: { ...(original.spec['pod'] as object), secret: name + '-runner' } } });
    const control = controller(); control.observer.start();
    try {
      for (let i = 0; i < 100 && !admissionCalls.includes(projectId); i++) await Bun.sleep(10);
      await control.reconciled();
      expect(admissionCalls).toContain(projectId);
      expect(await k8s.get(Resources.Pod!, name, 'crewstation-system')).toBeUndefined();
      expect(await k8s.get(Resources.Secret!, name + '-runner', 'crewstation-system')).toBeUndefined();
      expect(warnings.some((message) => message.includes('项目 ' + projectId + ' 不存在'))).toBe(true);
    } finally { await control.observer.stop(); }
    let applied = false;
    const closedId = newResourceId() as ProjectId;
    await tdb.db.execute(sql`INSERT INTO resources.deletion_fences(project_id,operation_id) VALUES (${closedId},${newResourceId()})`);
    expect(await resources.api.projectDeletion.withAdmission(closedId, async () => { applied = true; })).toBe(false);
    expect(applied).toBe(false);
    expect(admissionCalls).not.toContain(closedId);
  });

  test('修复迁移仅重算哨兵，保留清理中与用途验证未退容量，重复执行不减活动容量', async () => {
    const repair = await Bun.file(new URL('../adapters/persistence/migrations/0016_profile_test_admission_repair.sql', import.meta.url)).text();
    const count = async () => (await tdb.db.execute(sql`SELECT running FROM task_runtime.admissions WHERE project_id=${PROFILE_TEST_PROJECT_ID}`))[0]?.['running'];
    await tdb.db.execute(sql`UPDATE task_runtime.admissions SET running=4 WHERE project_id=${PROFILE_TEST_PROJECT_ID}`);
    await tdb.db.execute(sql.raw(repair));
    expect(await count()).toBe(0);
    await tdb.db.execute(sql`UPDATE task_runtime.environments SET state='releasing' WHERE kind='profile-test'`);
    await tdb.db.execute(sql.raw(repair));
    expect(await count()).toBe(1);
    await tdb.db.execute(sql`UPDATE task_runtime.environments SET state='released',render=jsonb_set(render,'{runtimeValidation}','{"quotaHeld":true}'::jsonb) WHERE kind='profile-test'`);
    await tdb.db.execute(sql.raw(repair));
    expect(await count()).toBe(1);
    await tdb.db.execute(sql.raw(repair));
    expect(await count()).toBe(1);
    await tdb.db.execute(sql`UPDATE task_runtime.environments SET render=jsonb_set(render,'{runtimeValidation,quotaHeld}','false'::jsonb) WHERE kind='profile-test'`);
    await tdb.db.execute(sql.raw(repair));
    expect(await count()).toBe(0);
  });

});

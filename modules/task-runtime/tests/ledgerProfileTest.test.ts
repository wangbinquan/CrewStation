import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { RunnerCommand, RunnerEvent, TaskId } from '@crewstation/contracts';
import { LaunchSpecSchema, PLATFORM_ENV } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources, taskPodObject } from '@crewstation/k8s';
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
  const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
  const emit = (taskId: string, event: RunnerEvent) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at: new Date().toISOString(), event }); events.set(taskId, list); };
  const agent = (agentId: string, seq: number, event: Record<string, unknown> & { type: string }): RunnerEvent => ({ kind: 'agent', event: { agentId, seq, at: new Date().toISOString(), ...event } } as RunnerEvent);

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
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

  /** 模拟调和器：等要建的档位测试记录出现，停一会儿（让等 Runner 的轮询先看到 Pod 还不在），再照期望建 Pod、要值、交回实例，Runner 连上。 */
  async function reconcileOnce(): Promise<{ id: TaskId; spec: Record<string, unknown>; values: Record<string, string> }> {
    for (;;) {
      const record = (await resources.api.list({ kind: 'agent-execution' })).find((entry) => entry.conditions.some((c) => c.type === 'Provisioning' && c.status === 'true'));
      if (record) {
        await Bun.sleep(150);
        const id = record.id as TaskId, pod = record.spec['pod'] as { secret: string };
        const values = await runtime.api.runnerValues(id);
        const created = await k8s.create(taskPodObject({ name: record.spec.children[0]!.name, namespace: 'crewstation-system', taskId: id, workload: 'profile-test', project: 'platform', service: 'profile-test',
          image, workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workVolume: { emptyDir: true }, envFromSecret: pod.secret }));
        await k8s.mergePatch(Resources.Pod!, created.metadata.name, 'crewstation-system', { status: { phase: 'Running', containerStatuses: [{ name: 'task', imageID: image }] } });
        await runtime.api.bindWorkload(id, created.metadata.uid!);
        expect(await runtime.api.onRunnerConnected(id, values['CS_RUNNER_TOKEN']!)).toBe(true);
        return { id, spec: record.spec as Record<string, unknown>, values };
      }
      await Bun.sleep(10);
    }
  }

  test('受理只登记、临时目录不等卷；Pod 建出之前不判没起来；Runner 的内容建的时候才给（平台服务、没有租户配置）；测完释放', async () => {
    const input: ProfileTestRunInput = {
      testId: '01a0bf5d-8f4b-7435-8062-f84a0a1cbb01', profile: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 1, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'anthropic/claude-x' }), image,
      beforeStart: { profile: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 1, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: true },
      prompt: `Output this exact token verbatim and nothing else: ${nonce}`, expectedReply: nonce,
    };
    const run = runtime.api.runProfileTest(input, async () => undefined, async () => true);
    const { id, spec, values } = await reconcileOnce();
    expect(spec['pod']).toMatchObject({ image, emptyDir: true, workload: 'profile-test', project: 'platform', service: 'profile-test', secret: `${(spec as { children: Array<{ name: string }> }).children[0]!.name}-runner-1` });
    expect(spec['pod']).not.toHaveProperty('pvc');
    expect(values).toMatchObject({ [PLATFORM_ENV.project]: 'platform', [PLATFORM_ENV.service]: 'profile-test' });
    const outcome = await run;
    expect(outcome).toMatchObject({ state: 'passed', outcome: 'passed' });
    expect(await runtime.api.getEnvironment(id)).toMatchObject({ kind: 'profile-test', state: 'released' });
    expect((await resources.api.get(id))?.desired).toBe('absent');
  });
});

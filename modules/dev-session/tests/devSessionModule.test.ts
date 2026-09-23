import { computeId } from './computeFixture';
import { computeSelector } from './computeFixture';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, AgentEvent, ProjectId, RunnerCommand, RunnerEvent, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionModule } from '../wiring';
import { createDevSessionModule, devSessionMigrations } from '../wiring';
import { PREVIEW_PEEK_MS } from '../application/sessionLifecycle';
import { readyWorkspace } from './workspaceFixture';
import type { FakeProfile } from './computeFixture';
import { fakeComputeCatalog } from './computeFixture';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let dev: DevSessionModule;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const owner: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };
const developer: Actor = { userId: '01a0bf5d-8f4b-7a4e-8eb2-04fca5c047bf' as UserId, isAdmin: false };
const envs = new Map<string, EnvironmentView & { createdBy: UserId; preview?: { command: string[]; port: number; healthPath: string } }>();
/** RFC-006：每个 headless Agent 一个执行环境；这里假定子 Runner 立即连上。 */
const executions = new Map<string, EnvironmentView>();
const computeProfiles: FakeProfile[] = [{ name: 'balanced', protocol: 'claude-code', model: 'anthropic/claude-sonnet-5', isDefault: true }, { name: 'term-cli', protocol: 'terminal' }];
const commands: RunnerCommand[] = [];
let agentEvents: Array<{ seq: number; at: string; event: RunnerEvent }> | undefined;
const notices: string[] = [];
const issued: Array<{ taskId: TaskId; projectId: ProjectId; serviceId: ServiceId; userId: UserId }> = [];
let dirty = '';
/** 模拟 Runner 收到预览查询却一直不回（cs-session 卡住）。 */
let previewHangs = false;
/** 释放调用（任务号、原因）；releaseFails 模拟集群一时删不掉。 */
const releases: Array<[string, string]> = [];
let releaseFails = false;
const published: unknown[] = [];
const manifest = 'apiVersion: crewstation/v2\nkind: DigitalWorker\nspec:\n  service: { command: [bun, run, src/main.ts], port: 3000, healthPath: /healthz, servicePlanId: 01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10 }\n  development: { command: [bun, run, --watch, src/main.ts], port: 3000 }\n';
/** RFC-001 之前的写法：老仓库里还有一大堆。 */
const legacyManifest = `${manifest}  tasks:\n    profile: coding-medium\n    agentProfiles: [{ name: chat-v1, driver: stub, model: stub/echo, permission: read-only }]\n`;
let manifestText = manifest;

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([devSessionMigrations]);
  dev = createDevSessionModule({
    apiCatalog: { listOperations: async () => [] },
    db: tdb.db,
    environments: {
      createNativeExecution: async (input) => {
        const env: EnvironmentView = { id: input.id, projectId, serviceId, state: 'running', podName: `agt-${input.id.slice(4)}`, connected: true, traceId: 'trace', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
          native: { purpose: input.purpose, parentTaskId: input.parentTaskId, agentId: input.agentId, runnerId: input.runnerId, state: 'running', profile: { name: input.profile ?? 'coding-medium', cpu: '1', memory: '2Gi', storage: '2Gi' } } };
        executions.set(input.id, env);
        return env;
      },
      captureStartupLog: async () => undefined,
      getRebuild: async () => undefined,
      inspectRebuild: async () => { throw new Error("恢复预检未设置"); },
      requestRebuild: async () => { throw new Error("恢复请求未设置"); },
      createEnvironment: async (input) => { const env = { id: Bun.randomUUIDv7() as TaskId, projectId, serviceId: input.serviceId, state: 'running' as const, podName: 'task-x', connected: true, branch: input.branch, traceId: 'trace', createdAt: new Date().toISOString(), lastActivityAt: new Date('2026-09-11T00:00:00Z').toISOString(), createdBy: input.createdBy, preview: input.preview }; envs.set(env.id, env); return env; },
      releaseEnvironment: async (taskId, reason) => { releases.push([taskId, reason]); if (releaseFails) throw new Error('cluster unavailable'); const env = envs.get(taskId)!; envs.delete(taskId); return { ...env, state: 'released' }; },
      getEnvironment: async (taskId) => envs.get(taskId) ?? executions.get(taskId),
      findDevSession: async (_projectId, options) => [...envs.values()].find((env) => ['creating', 'running', 'releasing'].includes(env.state)) ?? (options?.includeLatestFailure ? [...envs.values()].at(-1) : undefined),
      listRunningDevSessions: async () => [...envs.values()],
      touch: async (taskId) => { const env = envs.get(taskId); if (env) env.lastActivityAt = new Date().toISOString(); },
      canOpenStream: async () => true,
    },
    runner: {
      sendCommand: async (_t, command) => {
        commands.push(command);
        if (command.type === 'workspaceStatus') return { ...readyWorkspace(), uncommittedCount: dirty ? 2 : 0, uncommitted: dirty ? [{ path: 'src/main.ts', status: '.M', index: '.', worktree: 'M' }, { path: 'new.ts', status: 'untracked', index: '?', worktree: '?' }] : [], unpushed: { status: 'ready', commits: [{ sha: 'abc123', subject: 'wip' }], count: 1, truncated: false } };
        if (command.type === 'exec' && command.command[0] === 'sh') return { execId: command.execId, exitCode: 0, stdout: '', stderr: '', durationMs: 1, truncated: false };
        if (command.type === 'exec') return { exitCode: 0, stdout: 'abc123 wip', stderr: '' };
        if (command.type === 'previewStatus') return previewHangs ? new Promise(() => {}) : { state: 'ready', port: 3000, restarts: 0 };
        return {};
      },
      listEvents: async () => agentEvents ?? [
        { seq: 1, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: '01a0bf5d-8f4b-7aaa-86ba-278f66412c7f', seq: 0, at: new Date().toISOString(), type: 'started', spec: { compute: computeId('balanced'), profileRevision: 1, protocol: 'claude-code', model: 'anthropic/claude-sonnet-5', permission: 'read-only' } } } },
        { seq: 2, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: '01a0bf5d-8f4b-7aaa-86ba-278f66412c7f', seq: 1, at: new Date().toISOString(), type: 'completed', sessionId: 's1' } } },
        { seq: 3, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: '01a0bf5d-8f4b-7519-855a-71aee3eae874', seq: 0, at: new Date().toISOString(), type: 'text', text: '没有 started 事件' } } },
      ],
    },
    scm: { listBranches: async (_s, compare) => [{ name: 'main', headSha: 'abc', isDefault: true, behindPreview: compare.previewSha ? 2 : null, behindProd: null }], pushUrl: async () => ({ url: 'http://oauth2:secret@gitlab/demo.git', expiresAt: new Date().toISOString() }), readFile: async () => manifestText },
    releases: { publish: async (_a, _s, input) => { published.push(input); return { id: '01a0bf5d-8f4b-7fe7-81b4-3ca489d1f621', serviceId, tag: 'v0.1.1', commitSha: 'abc', branch: input.branch, status: 'pending', createdBy: owner.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never; }, getSlots: async () => [{ name: 'preview', active: false, commitSha: 'p1', replicas: 1, readyReplicas: 1, state: 'ready', host: 'preview.demo.cs.localhost' }, { name: 'prod', active: true, replicas: 0, readyReplicas: 0, state: 'empty', host: 'demo.cs.localhost' }] },
    authorizer: { authorize: async (actor, _p, action) => { if (action === 'force-release-session' && actor.userId !== owner.userId) throw new Error('forbidden'); }, ownerOf: async () => owner.userId },
    services: { resolveServiceOfProject: async () => ({ serviceId, slug: 'demo', name: 'demo' }) },
    notifier: { notify: async (_p, users, message) => { notices.push(`${users.length}:${message}`); } },
    compute: fakeComputeCatalog(() => computeProfiles),
    credentials: { issueDevSessionToken: async (binding) => { issued.push(binding); return { token: `tok-${binding.taskId}`, expiresAt: new Date().toISOString() }; } },
    isAdmin: async () => false,
    settings: { idleMinutes: 30, userDomain: 'cs.localhost', mcp: [{ name: 'capabilities', url: 'http://mcp-capabilities.svc.cs.internal/mcp' }], defaultPreviewPort: 3000 },
    clock: fixedClock('2026-09-11T01:00:00Z'),
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('dev-session module', () => {
  test('开会话读 Manifest 起预览、一项目一会话、分支落后数、Agent 带 MCP、发布代推、空闲提醒、强制释放', async () => {
    const session = await dev.api.openSession(developer, projectId, { branch: 'main' });
    expect(session).toMatchObject({ state: 'running', branch: 'main', previewHost: 'dev.demo.cs.localhost' });
    const created = [...envs.values()][0]!;
    expect(created.preview).toEqual({ command: ['bun', 'run', '--watch', 'src/main.ts'], port: 3000, healthPath: '/healthz' });
    await expect(dev.api.openSession(developer, projectId, { branch: 'main' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await dev.api.getSession(developer, projectId))?.preview).toBe('ready');
    expect((await dev.api.listBranches(developer, projectId))[0]).toMatchObject({ name: 'main', behindPreview: 2 });

    const agent = await dev.api.startAgent(developer, created.id, { compute: computeSelector('balanced'), prompt: '你好' });
    expect(agent.execution).toMatchObject({ state: 'running' });
    await dev.api.dispatchPendingNativeExecution(agent.execution!.taskId);
    const start = commands.find((c) => c.type === 'startAgent');
    // 请求里没有权限可选，派发一律完全权限（D59）。
    expect(start).toMatchObject({ mode: 'interactive', initialPrompt: '你好', permission: 'full', mcp: [{ name: 'capabilities' }] });
    // 会话级短期令牌进了 MCP 连接头，并且绑定的是本会话、本项目、本服务与启动者（Design §5.9）。
    expect(issued).toEqual([{ taskId: created.id, projectId, serviceId, userId: developer.userId }]);
    expect(start).toMatchObject({ mcp: [{ headers: { 'x-cs-dev-session-token': `tok-${created.id}` } }] });
    await dev.api.sendMessage(developer, created.id, agent.agentId, { content: '继续' });
    const listed = await dev.api.listAgents(developer, created.id);
    // 档位与权限来自 started 事件的 spec，不是编出来的；租户面不返回厂商与模型（RFC-001）。
    expect(listed[0]).toMatchObject({ agentId: '01a0bf5d-8f4b-7aaa-86ba-278f66412c7f', state: 'completed', sessionId: 's1', compute: computeId('balanced'), permission: 'read-only', profileRevision: 1 });
    expect(listed[0]).not.toHaveProperty('model');
    expect(listed[0]).not.toHaveProperty('driver');
    // 没有 started 事件时权限就是平台唯一派发的那一档（D59），档位如实留空。
    expect(listed[1]).toMatchObject({ agentId: '01a0bf5d-8f4b-7519-855a-71aee3eae874', permission: 'full', compute: '' });

    dirty = ' M src/main.ts\n?? new.ts\n';
    await expect(dev.api.publish(developer, projectId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', details: { uncommitted: ['src/main.ts', 'new.ts'] } });
    dirty = '';
    const release = await dev.api.publish(developer, projectId, { branch: 'main', version: 'patch' });
    expect(release.tag).toBe('v0.1.1');
    const push = commands.find((c) => c.type === 'exec' && c.command[0] === 'sh') as Extract<RunnerCommand, { type: 'exec' }>;
    expect(push.env.GIT_CONFIG_VALUE_0).toContain('oauth2:');
    expect(push.command.join(' ')).not.toContain('secret');
    expect(published).toHaveLength(1);

    created.lastActivityAt = new Date('2026-09-10T23:00:00Z').toISOString();
    expect(await dev.api.sendIdleReminders()).toBe(1);
    expect(await dev.api.sendIdleReminders()).toBe(0);
    expect(notices[0]).toMatch(/^2:开发会话已空闲/);

    await expect(dev.api.releaseSession(owner, projectId)).rejects.toMatchObject({ kind: 'precondition' });
    const released = await dev.api.releaseSession(owner, projectId, { force: true });
    expect(released.session.state).toBe('released');
    expect(released.unpushed).toEqual(['abc123 wip']);
  });

  test('算力档位：省略即 default、不存在的档位报错并列出可选、未设默认报 precondition、终端档位不能用于 headless（RFC-006）', async () => {
    envs.clear();
    await dev.api.openSession(developer, projectId, { branch: 'main' });
    const created = [...envs.values()][0]!;
    commands.length = 0;

    const startAndDispatch = async (input: Parameters<typeof dev.api.startAgent>[2]) => {
      const dto = await dev.api.startAgent(developer, created.id, input);
      await dev.api.dispatchPendingNativeExecution(dto.execution!.taskId);
      return dto;
    };
    // 省略 compute → 解析到管理员设为默认的档位，命令带上固定修订与 launch（显式二进制）。
    await startAndDispatch({ prompt: '用默认档' });
    expect(commands.find((c) => c.type === 'startAgent')).toMatchObject({ compute: computeId('balanced'), profileRevision: 1, launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', model: 'anthropic/claude-sonnet-5' }, beforeStart: { profile: computeId('balanced'), revision: 1 } });
    commands.length = 0;
    await startAndDispatch({ compute: computeSelector('default'), prompt: '显式 default' });
    expect(commands.find((c) => c.type === 'startAgent')).toMatchObject({ compute: computeId('balanced') });

    // 不存在的档位：报错里要列出可选项，否则调用方只能去猜。
    const bad = await dev.api.startAgent(developer, created.id, { compute: computeSelector('nope'), prompt: 'x' }).catch((e: unknown) => e);
    expect(bad).toMatchObject({ kind: 'validation', details: { available: [computeId('balanced'), computeId('term-cli')] } });
    // 通用终端档位只能用于「＋ CLI」（C6）。
    await expect(dev.api.startAgent(developer, created.id, { compute: computeSelector('term-cli'), prompt: 'x' })).rejects.toMatchObject({ kind: 'validation', details: { code: 'terminal_profile_not_allowed' } });

    // 默认档没配置时报 precondition，不静默挑一档——静默挑会让业务以为自己拿到了预期算力。
    computeProfiles[0]!.isDefault = false;
    const noDefault = await dev.api.startAgent(developer, created.id, { prompt: 'y' }).catch((e: unknown) => e);
    expect(noDefault).toMatchObject({ kind: 'precondition', details: { code: 'no_default_profile' } });
    computeProfiles[0]!.isDefault = true;

    await dev.api.releaseSession(owner, projectId, { force: true });
  });

  test('Manifest 坏了照样能开会话，只是没有预览，并说清该怎么改（RFC-001）', async () => {
    manifestText = legacyManifest;
    try {
      const session = await dev.api.openSession(developer, projectId, { branch: 'main' });
      expect(session.state).toBe('running');
      expect(session.message).toContain('Unrecognized keys');
      // 错误要能照着改：指出换成 compute，并说去哪儿看可用档位。
      expect(session.message).toContain('compute: { kind: profile, profileId: <UUIDv7> }');
      expect(session.message).toContain('算力档位');
      expect(session.message).toContain('compute: { kind: default }');
      // 没有预览配置：开发容器不会拿着半截 Manifest 去起预览。
      expect([...envs.values()].at(-1)?.preview).toBeUndefined();
    } finally {
      manifestText = manifest;
      await dev.api.releaseSession(developer, projectId, { force: true });
    }
  });

  test('失败会话读取保留 taskId 与原因，不调用旧 Runner，也不阻止用户显式创建新会话', async () => {
    envs.clear();
    const first = await dev.api.openSession(developer, projectId, { branch: 'main' });
    const failed = envs.get(first.taskId)!;
    Object.assign(failed, { state: 'failed', connected: false, message: '容器运行失败：OOMKilled，退出码 137' });
    const commandsBefore = commands.length;
    // GET 只读展示故障；不能将其视为从未开过会话，也不能为展示状态启动或重连旧进程。
    expect(await dev.api.getSession(developer, projectId)).toMatchObject({ taskId: first.taskId, state: 'failed', preview: 'stopped', message: failed.message });
    const workspace = await dev.api.workspaceStatus(developer, projectId);
    expect(workspace).toMatchObject({ taskId: first.taskId, status: 'unavailable' });
    expect(workspace.status === 'unavailable' && workspace.reason).toContain('OOMKilled');
    expect(await dev.api.versionComparison(developer, projectId)).toMatchObject({ taskId: first.taskId, workspace: { status: 'unavailable' }, commits: { status: 'unavailable' } });
    expect(commands).toHaveLength(commandsBefore);
    const second = await dev.api.openSession(developer, projectId, { branch: 'main' });
    expect(second.taskId).not.toBe(first.taskId);
    expect(envs.get(first.taskId)?.state).toBe('failed');
    expect((await dev.api.getSession(developer, projectId))?.taskId).toBe(second.taskId);
    envs.clear();
  });

  test('Runner 不回预览查询时读会话照常返回，预览按读不到处理，不等满命令超时', async () => {
    const session = await dev.api.openSession(developer, projectId, { branch: 'main' });
    previewHangs = true;
    try {
      const started = performance.now();
      expect(await dev.api.getSession(developer, projectId)).toMatchObject({ taskId: session.taskId, state: 'running', preview: 'stopped' });
      expect(performance.now() - started).toBeLessThan(PREVIEW_PEEK_MS + 500);
    } finally { previewHangs = false; envs.clear(); }
  });

  test('历史 OpenCode 等待下一轮时显示待输入，继续对话保留同一身份且不提前结束', async () => {
    const session = await dev.api.openSession(developer, projectId, { branch: 'main' });
    agentEvents = [];
    const append = (event: Omit<AgentEvent, 'agentId' | 'seq' | 'at'>) => {
      const seq = agentEvents!.length;
      const at = new Date(Date.UTC(2026, 8, 14, 17, 36, seq)).toISOString();
      agentEvents!.push({ seq, at, event: { kind: 'agent', event: { agentId: '01a0bf5d-8f4b-7a44-812d-6739541a37c9', seq, at, ...event } } });
      return at;
    };
    try {
      const startedAt = append({ type: 'started', spec: { compute: computeId('qa-opencode'), profileRevision: 3, protocol: 'opencode', model: 'opencode/big-pickle', permission: 'read-only' } });
      append({ type: 'session', sessionId: 'ses_history' });
      append({ type: 'text', text: 'RFC003_HISTORY_ONE' });
      append({ type: 'status', status: 'waiting' });
      // 实机两轮均发出 waiting，但原投影把所有 status 当 running，页面一直显示执行中。
      const identity = { agentId: '01a0bf5d-8f4b-7a44-812d-6739541a37c9', taskId: session.taskId, sessionId: 'ses_history', compute: computeId('qa-opencode'), permission: 'read-only', profileRevision: 3, startedAt } as const;
      expect(await dev.api.listAgents(developer, session.taskId)).toEqual([{ ...identity, state: 'awaiting-input' }]);

      for (const status of ['diagnostic information', undefined]) {
        append({ type: 'status', status });
        expect(await dev.api.listAgents(developer, session.taskId)).toEqual([{ ...identity, state: 'awaiting-input' }]);
      }
      append({ type: 'status', status: 'running' });
      expect(await dev.api.listAgents(developer, session.taskId)).toEqual([{ ...identity, state: 'running' }]);
      append({ type: 'status', status: 'waiting' });
      append({ type: 'text', text: 'RFC003_HISTORY_ONE RFC003_HISTORY_TWO' });
      expect(await dev.api.listAgents(developer, session.taskId)).toEqual([{ ...identity, state: 'running' }]);
      append({ type: 'status', status: 'waiting' });
      expect(await dev.api.listAgents(developer, session.taskId)).toEqual([{ ...identity, state: 'awaiting-input' }]);

      const endedAt = append({ type: 'completed' });
      append({ type: 'status', status: 'diagnostic information' });
      expect(await dev.api.listAgents(developer, session.taskId)).toEqual([{ ...identity, state: 'completed', endedAt }]);
    } finally {
      agentEvents = undefined;
      envs.clear();
    }
  });
  test('按原分支重新开始（RFC-022 2026-09-23 修订）：失败在检出或更早的会话在新会话开好后回收；等待连接失败、不是最近一次失败的不回收；回收失败不影响新会话', async () => {
    const startup = (failedAt: 'checkout' | 'connect') => ({ state: 'failed' as const, startedAt: '2026-09-11T00:59:00.000Z', endedAt: '2026-09-11T00:59:09.000Z', stages: [
      { kind: 'queue' as const, state: 'succeeded' as const }, { kind: 'container' as const, state: 'succeeded' as const },
      { kind: 'checkout' as const, state: failedAt === 'checkout' ? 'failed' as const : 'succeeded' as const },
      { kind: 'connect' as const, state: failedAt === 'connect' ? 'failed' as const : 'pending' as const }, { kind: 'ready' as const, state: 'pending' as const }] });
    const fail = (taskId: string, at: 'checkout' | 'connect') => { Object.assign(envs.get(taskId)!, { state: 'failed', connected: false, startup: startup(at) }); return taskId; };
    const failedSession = async (at: 'checkout' | 'connect') => fail((await dev.api.openSession(developer, projectId, { branch: 'main' })).taskId, at);
    envs.clear(); releases.length = 0;
    const checkoutFailed = await failedSession('checkout');
    const restarted = await dev.api.openSession(developer, projectId, { branch: 'main', restartOf: checkoutFailed as TaskId });
    expect(restarted).toMatchObject({ state: 'running', branch: 'main' });
    expect(releases).toEqual([[checkoutFailed, 'failed']]);
    expect(envs.has(checkoutFailed)).toBe(false);
    // 等待连接失败：工作卷里已有工作树，要走恢复，不回收。
    envs.clear(); releases.length = 0;
    const connectFailed = await failedSession('connect');
    await dev.api.openSession(developer, projectId, { branch: 'main', restartOf: connectFailed as TaskId });
    expect(releases).toEqual([]);
    expect(envs.get(connectFailed)?.state).toBe('failed');
    // 带的不是本项目最近一次失败（页面停留期间又失败过一次）：不回收。
    envs.clear();
    const older = await failedSession('checkout');
    await failedSession('checkout');
    await dev.api.openSession(developer, projectId, { branch: 'main', restartOf: older as TaskId });
    expect(releases).toEqual([]);
    // 回收失败只记下来，新会话照样开好。
    envs.clear();
    const flaky = await failedSession('checkout');
    releaseFails = true;
    try { expect(await dev.api.openSession(developer, projectId, { branch: 'main', restartOf: flaky as TaskId })).toMatchObject({ state: 'running' }); }
    finally { releaseFails = false; }
    expect(releases).toEqual([[flaky, 'failed']]);
    envs.clear();
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, AgentEvent, ProjectId, RunnerCommand, RunnerEvent, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionModule } from '../wiring';
import { createDevSessionModule, devSessionMigrations } from '../wiring';
import { readyWorkspace } from './workspaceFixture';
import type { FakeProfile } from './computeFixture';
import { fakeComputeCatalog } from './computeFixture';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let dev: DevSessionModule;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const owner: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const developer: Actor = { userId: 'usr_1123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const envs = new Map<string, EnvironmentView & { createdBy: UserId; preview?: { command: string[]; port: number; healthPath: string } }>();
const computeProfiles: FakeProfile[] = [{ name: 'balanced', protocol: 'claude-code', model: 'anthropic/claude-sonnet-5', isDefault: true }, { name: 'term-cli', protocol: 'terminal' }];
const commands: RunnerCommand[] = [];
let agentEvents: Array<{ seq: number; at: string; event: RunnerEvent }> | undefined;
const notices: string[] = [];
const issued: Array<{ taskId: TaskId; projectId: ProjectId; serviceId: ServiceId; userId: UserId }> = [];
let dirty = '';
const published: unknown[] = [];
const manifest = 'apiVersion: crewstation/v1\nkind: DigitalWorker\nspec:\n  service: { command: [bun, run, src/main.ts], port: 3000, healthPath: /healthz, plan: standard-small }\n  development: { command: [bun, run, --watch, src/main.ts], port: 3000 }\n';
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
      createNativeExecution: async () => { throw new Error('独立执行未设置'); },
      getRebuild: async () => undefined,
      inspectRebuild: async () => { throw new Error("恢复预检未设置"); },
      requestRebuild: async () => { throw new Error("恢复请求未设置"); },
      createEnvironment: async (input) => { const env = { id: `tsk_${Bun.randomUUIDv7().replace(/-/g, '')}` as TaskId, projectId, serviceId: input.serviceId, state: 'running' as const, podName: 'task-x', connected: true, branch: input.branch, traceId: 'trace', createdAt: new Date().toISOString(), lastActivityAt: new Date('2026-09-11T00:00:00Z').toISOString(), createdBy: input.createdBy, preview: input.preview }; envs.set(env.id, env); return env; },
      releaseEnvironment: async (taskId) => { const env = envs.get(taskId)!; envs.delete(taskId); return { ...env, state: 'released' }; },
      getEnvironment: async (taskId) => envs.get(taskId),
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
        if (command.type === 'previewStatus') return { state: 'ready', port: 3000, restarts: 0 };
        return {};
      },
      listEvents: async () => agentEvents ?? [
        { seq: 1, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'agt_1', seq: 0, at: new Date().toISOString(), type: 'started', spec: { compute: 'balanced', profileRevision: 1, protocol: 'claude-code', model: 'anthropic/claude-sonnet-5', permission: 'read-only' } } } },
        { seq: 2, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'agt_1', seq: 1, at: new Date().toISOString(), type: 'completed', sessionId: 's1' } } },
        { seq: 3, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'agt_2', seq: 0, at: new Date().toISOString(), type: 'text', text: '没有 started 事件' } } },
      ],
    },
    scm: { listBranches: async (_s, compare) => [{ name: 'main', headSha: 'abc', isDefault: true, behindPreview: compare.previewSha ? 2 : null, behindProd: null }], pushUrl: async () => ({ url: 'http://oauth2:secret@gitlab/demo.git', expiresAt: new Date().toISOString() }), readFile: async () => manifestText },
    releases: { publish: async (_a, _s, input) => { published.push(input); return { id: 'rel_0123456789abcdef0123456789abcdef', serviceId, tag: 'v0.1.1', commitSha: 'abc', branch: input.branch, status: 'pending', createdBy: owner.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never; }, getSlots: async () => [{ name: 'preview', active: false, commitSha: 'p1', replicas: 1, readyReplicas: 1, state: 'ready', host: 'preview.demo.cs.localhost' }, { name: 'prod', active: true, replicas: 0, readyReplicas: 0, state: 'empty', host: 'demo.cs.localhost' }] },
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

    const agent = await dev.api.startAgent(developer, created.id, { compute: 'balanced', permission: 'edit', prompt: '你好' });
    const start = commands.find((c) => c.type === 'startAgent');
    expect(start).toMatchObject({ mode: 'interactive', initialPrompt: '你好', mcp: [{ name: 'capabilities' }] });
    // 会话级短期令牌进了 MCP 连接头，并且绑定的是本会话、本项目、本服务与启动者（Design §5.9）。
    expect(issued).toEqual([{ taskId: created.id, projectId, serviceId, userId: developer.userId }]);
    expect(start).toMatchObject({ mcp: [{ headers: { 'x-cs-dev-session-token': `tok-${created.id}` } }] });
    await dev.api.sendMessage(developer, created.id, agent.agentId, { content: '继续' });
    const listed = await dev.api.listAgents(developer, created.id);
    // 档位与权限来自 started 事件的 spec，不是编出来的；租户面不返回厂商与模型（RFC-001）。
    expect(listed[0]).toMatchObject({ agentId: 'agt_1', state: 'completed', sessionId: 's1', compute: 'balanced', permission: 'read-only', profileRevision: 1 });
    expect(listed[0]).not.toHaveProperty('model');
    expect(listed[0]).not.toHaveProperty('driver');
    // 没有 started 事件时留最小权限的占位，绝不谎称 edit。
    expect(listed[1]).toMatchObject({ agentId: 'agt_2', permission: 'read-only', compute: '' });

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

    // 省略 compute → 解析到管理员设为默认的档位，命令带上固定修订与 launch（显式二进制）。
    await dev.api.startAgent(developer, created.id, { permission: 'edit', prompt: '用默认档' });
    expect(commands.find((c) => c.type === 'startAgent')).toMatchObject({ compute: 'balanced', profileRevision: 1, launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', model: 'anthropic/claude-sonnet-5' }, beforeStart: { profile: 'balanced', revision: 1 } });
    commands.length = 0;
    await dev.api.startAgent(developer, created.id, { compute: 'default', permission: 'edit', prompt: '显式 default' });
    expect(commands.find((c) => c.type === 'startAgent')).toMatchObject({ compute: 'balanced' });

    // 不存在的档位：报错里要列出可选项，否则调用方只能去猜。
    const bad = await dev.api.startAgent(developer, created.id, { compute: 'nope', permission: 'edit', prompt: 'x' }).catch((e: unknown) => e);
    expect(bad).toMatchObject({ kind: 'validation', details: { available: ['balanced', 'term-cli'] } });
    // 通用终端档位只能用于「＋ CLI」（C6）。
    await expect(dev.api.startAgent(developer, created.id, { compute: 'term-cli', permission: 'edit', prompt: 'x' })).rejects.toMatchObject({ kind: 'validation', details: { code: 'terminal_profile_not_allowed' } });

    // 默认档没配置时报 precondition，不静默挑一档——静默挑会让业务以为自己拿到了预期算力。
    computeProfiles[0]!.isDefault = false;
    const noDefault = await dev.api.startAgent(developer, created.id, { permission: 'edit', prompt: 'y' }).catch((e: unknown) => e);
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
      expect(session.message).toContain('compute: <档位名>');
      expect(session.message).toContain('算力档位');
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

  test('历史 OpenCode 等待下一轮时显示待输入，继续对话保留同一身份且不提前结束', async () => {
    const session = await dev.api.openSession(developer, projectId, { branch: 'main' });
    agentEvents = [];
    const append = (event: Omit<AgentEvent, 'agentId' | 'seq' | 'at'>) => {
      const seq = agentEvents!.length;
      const at = new Date(Date.UTC(2026, 8, 14, 17, 36, seq)).toISOString();
      agentEvents!.push({ seq, at, event: { kind: 'agent', event: { agentId: 'agt_history', seq, at, ...event } } });
      return at;
    };
    try {
      const startedAt = append({ type: 'started', spec: { compute: 'qa-opencode', profileRevision: 3, protocol: 'opencode', model: 'opencode/big-pickle', permission: 'read-only' } });
      append({ type: 'session', sessionId: 'ses_history' });
      append({ type: 'text', text: 'RFC003_HISTORY_ONE' });
      append({ type: 'status', status: 'waiting' });
      // 实机两轮均发出 waiting，但原投影把所有 status 当 running，页面一直显示执行中。
      const identity = { agentId: 'agt_history', taskId: session.taskId, sessionId: 'ses_history', compute: 'qa-opencode', permission: 'read-only', profileRevision: 3, startedAt } as const;
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
});

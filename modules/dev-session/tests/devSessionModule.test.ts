import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, RunnerCommand, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionModule } from '../wiring';
import { createDevSessionModule, devSessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let dev: DevSessionModule;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const owner: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const developer: Actor = { userId: 'usr_1123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const envs = new Map<string, EnvironmentView & { createdBy: UserId; preview?: { command: string[]; port: number; healthPath: string } }>();
const commands: RunnerCommand[] = [];
const notices: string[] = [];
const issued: Array<{ taskId: TaskId; projectId: ProjectId; serviceId: ServiceId; userId: UserId }> = [];
let dirty = '';
const published: unknown[] = [];
const manifest = 'apiVersion: crewstation/v1\nkind: DigitalWorker\nspec:\n  service: { command: [bun, run, src/main.ts], port: 3000, healthPath: /healthz, plan: standard-small }\n  development: { command: [bun, run, --watch, src/main.ts], port: 3000 }\n';

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([devSessionMigrations]);
  dev = createDevSessionModule({
    db: tdb.db,
    environments: {
      createEnvironment: async (input) => { const env = { id: `tsk_${Bun.randomUUIDv7().replace(/-/g, '')}` as TaskId, projectId, serviceId: input.serviceId, state: 'running' as const, podName: 'task-x', connected: true, branch: input.branch, traceId: 'trace', createdAt: new Date().toISOString(), lastActivityAt: new Date('2026-09-11T00:00:00Z').toISOString(), createdBy: input.createdBy, preview: input.preview }; envs.set(env.id, env); return env; },
      releaseEnvironment: async (taskId) => { const env = envs.get(taskId)!; envs.delete(taskId); return { ...env, state: 'released' }; },
      getEnvironment: async (taskId) => envs.get(taskId),
      findDevSession: async () => [...envs.values()][0],
      listRunningDevSessions: async () => [...envs.values()],
      touch: async (taskId) => { const env = envs.get(taskId); if (env) env.lastActivityAt = new Date().toISOString(); },
      canOpenStream: async () => true,
    },
    runner: {
      sendCommand: async (_t, command) => {
        commands.push(command);
        if (command.type === 'exec' && command.command.join(' ') === 'git status --porcelain') return { exitCode: 0, stdout: dirty, stderr: '' };
        if (command.type === 'exec' && command.command[0] === 'sh') return { exitCode: 0, stdout: '', stderr: '' };
        if (command.type === 'exec') return { exitCode: 0, stdout: 'abc123 wip', stderr: '' };
        if (command.type === 'previewStatus') return { state: 'ready', port: 3000, restarts: 0 };
        return {};
      },
      listEvents: async () => [
        { seq: 1, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'agt_1', seq: 0, at: new Date().toISOString(), type: 'started', spec: { driver: 'claude-code', model: 'anthropic/claude-sonnet-5', permission: 'read-only' } } } },
        { seq: 2, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'agt_1', seq: 1, at: new Date().toISOString(), type: 'completed', sessionId: 's1' } } },
        { seq: 3, at: new Date().toISOString(), event: { kind: 'agent', event: { agentId: 'agt_2', seq: 0, at: new Date().toISOString(), type: 'text', text: '没有 started 事件' } } },
      ],
    },
    scm: { listBranches: async (_s, compare) => [{ name: 'main', headSha: 'abc', isDefault: true, behindPreview: compare.previewSha ? 2 : null, behindProd: null }], pushUrl: async () => ({ url: 'http://oauth2:secret@gitlab/demo.git', expiresAt: new Date().toISOString() }), readFile: async () => manifest },
    releases: { publish: async (_a, _s, input) => { published.push(input); return { id: 'rel_0123456789abcdef0123456789abcdef', serviceId, tag: 'v0.1.1', commitSha: 'abc', branch: input.branch, status: 'pending', createdBy: owner.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never; }, getSlots: async () => [{ name: 'preview', active: false, commitSha: 'p1', replicas: 1, readyReplicas: 1, state: 'ready', host: 'preview.demo.cs.localhost' }, { name: 'prod', active: true, replicas: 0, readyReplicas: 0, state: 'empty', host: 'demo.cs.localhost' }] },
    authorizer: { authorize: async (actor, _p, action) => { if (action === 'force-release-session' && actor.userId !== owner.userId) throw new Error('forbidden'); }, ownerOf: async () => owner.userId },
    services: { resolveServiceOfProject: async () => ({ serviceId, slug: 'demo', name: 'demo' }) },
    notifier: { notify: async (_p, users, message) => { notices.push(`${users.length}:${message}`); } },
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

    const agent = await dev.api.startAgent(developer, created.id, { driver: 'stub', model: 'stub/echo', permission: 'edit', prompt: '你好' });
    const start = commands.find((c) => c.type === 'startAgent');
    expect(start).toMatchObject({ mode: 'interactive', initialPrompt: '你好', mcp: [{ name: 'capabilities' }] });
    // 会话级短期令牌进了 MCP 连接头，并且绑定的是本会话、本项目、本服务与启动者（Design §5.9）。
    expect(issued).toEqual([{ taskId: created.id, projectId, serviceId, userId: developer.userId }]);
    expect(start).toMatchObject({ mcp: [{ headers: { 'x-cs-dev-session-token': `tok-${created.id}` } }] });
    await dev.api.sendMessage(developer, created.id, agent.agentId, { content: '继续' });
    const listed = await dev.api.listAgents(developer, created.id);
    // 驱动、模型与权限来自 started 事件的 spec，不是编出来的。
    expect(listed[0]).toMatchObject({ agentId: 'agt_1', state: 'completed', sessionId: 's1', driver: 'claude-code', model: 'anthropic/claude-sonnet-5', permission: 'read-only' });
    // 没有 started 事件时留最小权限的占位，绝不谎称 edit。
    expect(listed[1]).toMatchObject({ agentId: 'agt_2', permission: 'read-only', model: '' });

    dirty = ' M src/main.ts\n?? new.ts\n';
    await expect(dev.api.publish(developer, projectId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', details: { uncommitted: ['src/main.ts', 'new.ts'] } });
    dirty = '';
    const release = await dev.api.publish(developer, projectId, { branch: 'main', version: 'patch' });
    expect(release.tag).toBe('v0.1.1');
    const push = commands.find((c) => c.type === 'exec' && c.command[0] === 'sh') as Extract<RunnerCommand, { type: 'exec' }>;
    expect(push.env.CS_PUSH_URL).toContain('oauth2:');
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
});

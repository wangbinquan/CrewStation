import { afterEach, expect, test } from 'bun:test';
import { chmod, chown, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeTerminalRecord, RunnerEvent, StartAgentTerminalCommand } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { BeforeStartRunner } from '../src/beforeStart/beforeStartRunner';
import { detectInterpreters } from '../src/beforeStart/interpreters';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';
import { NativeTerminalSupervisor, type NativeSupervisorDeps } from '../src/terminal/nativeSupervisor';
import { createNativePtyBackend } from '../src/terminal/nativePty';
import { launchSpec, material } from './profileFixtures';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

interface FixtureOptions { activityFactory?: NativeSupervisorDeps['activityFactory']; runnerId?: string; realPrepare?: boolean; logger?: NativeSupervisorDeps['logger']; readinessLimits?: NativeSupervisorDeps['readinessLimits']; cmd?: string[] }

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cs-native-pty-'));
  const agentsRoot = await mkdtemp(join(tmpdir(), 'cs-native-agents-'));
  if (probeCurrentUid() === 0) { await chown(root, 10001, 10001); await chmod(agentsRoot, 0o755); }
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }); await rm(agentsRoot, { recursive: true, force: true }); });
  const isolation = resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) });
  const launcher = createProcessLauncher({ isolation, processEnv: process.env, workerHome: root, logger: noopLogger });
  const events: RunnerEvent[] = [];
  const emit = (e: RunnerEvent) => events.push(e);
  const beforeStart = new BeforeStartRunner({ launcher, interpreters: await detectInterpreters(launcher, (b) => Bun.which(b)), emit, logger: noopLogger, baseDir: join(agentsRoot, 'agents') });
  let launches = 0;
  let disposed = 0;
  const paths = await createWorkdirPaths(root);
  const native = new NativeTerminalSupervisor({
    backend: createNativePtyBackend(launcher), launcher, paths, beforeStart, logger: options.logger ?? noopLogger, runnerId: options.runnerId, emit,
    ...(options.activityFactory ? { activityFactory: options.activityFactory } : {}),
    ...(options.readinessLimits ? { readinessLimits: options.readinessLimits } : {}),
    ...(options.realPrepare ? {} : { prepare: async (_spec, context) => {
      launches++;
      return { plan: { cmd: options.cmd ?? ['bash', '--noprofile', '--norc'], cwd: context.cwd, env: { ...context.env, PS1: 'test-ready> ' } }, dispose: () => { disposed++; } };
    } }),
  });
  cleanups.push(() => native.closeAll());
  const command = (id: string, overrides: Partial<StartAgentTerminalCommand> = {}): StartAgentTerminalCommand => ({
    id, type: 'startAgentTerminal', agentId: id, terminalId: `terminal-${id}`, runnerId: native.runnerId, requestFingerprint: id,
    compute: 'balanced', profileRevision: 3, launch: launchSpec('claude-code'), permission: 'edit', cols: 80, rows: 24, mcp: [], env: {}, beforeStart: material(), processAttemptId: `${id}:1`,
    ...overrides,
  });
  return { native, command, root: paths.root, events, beforeStart, launches: () => launches, disposed: () => disposed };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** 每次启动先过启动前 Hook：启动命令回的是 starting 名册，进程就绪要等名册变化。 */
async function settled(f: Fixture, agentId: string, lifecycle: NativeTerminalRecord['lifecycle'] = 'running'): Promise<NativeTerminalRecord> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const record = f.native.list().terminals.find((r) => r.agentId === agentId);
    if (record?.lifecycle === lifecycle) return record;
    await Bun.sleep(10);
  }
  throw new Error(`${agentId} 没有进入 ${lifecycle}`);
}

async function outputContains(f: Fixture, terminalId: string, text: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const data = f.events.filter((e) => e.kind === 'terminalOutput' && e.terminalId === terminalId).map((e) => e.kind === 'terminalOutput' ? e.data : '').join('');
    if (data.includes(text)) return;
    await Bun.sleep(10);
  }
  throw new Error(`未收到终端输出 ${text}`);
}

async function nextPrompt(f: Fixture, terminalId: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const text = f.events.filter((e) => e.kind === 'terminalOutput' && e.terminalId === terminalId).map((e) => e.kind === 'terminalOutput' ? e.data : '').join('');
    if (text.split('test-ready> ').length >= 3) return;
    await Bun.sleep(10);
  }
  throw new Error('Ctrl+C 后没有回到 shell 提示');
}

test('独立执行容器采用受理时的 Runner 身份，并拒绝其他实例的启动请求；名册带档位修订与协议', async () => {
  const runnerId = crypto.randomUUID(), f = await fixture({ runnerId });
  expect(f.native.list()).toEqual({ runnerId, terminals: [] });
  expect(() => f.native.start({ ...f.command('wrong-runner'), runnerId: crypto.randomUUID() })).toThrow('进程已更换');
  expect(f.launches()).toBe(0);
  const accepted = await f.native.start(f.command('owned-runner'));
  expect(accepted).toMatchObject({ runnerId, lifecycle: 'starting', profileRevision: 3, protocol: 'claude-code' });
  const record = await settled(f, 'owned-runner');
  expect(record.beforeStart).toMatchObject({ state: 'succeeded' });
  await outputContains(f, record.terminalId, 'test-ready>');
});

test('状态监听器故障只标记未确认，原生进程仍能启动并使用', async () => {
  const f = await fixture({ activityFactory: () => { throw new Error('port unavailable'); } });
  await f.native.start(f.command('observer-failure', { launch: launchSpec('opencode') }));
  const record = await settled(f, 'observer-failure');
  expect(f.events.find((event) => event.kind === 'nativeActivity')).toMatchObject({ activity: { signal: { kind: 'source-unavailable', reason: 'source-error' } } });
  await outputContains(f, record.terminalId, 'test-ready>');
});

test('真实 PTY 并发启动只建一进程；detach／attach 保留原进程，输入／resize 互不串窗，stop 只结束目标', async () => {
  const f = await fixture();
  const [first, duplicate, second] = await Promise.all([f.native.start(f.command('one')), f.native.start(f.command('one')), f.native.start(f.command('two'))]);
  expect(first.agentId).toBe(duplicate.agentId);
  await settled(f, 'one');
  await settled(f, 'two');
  expect(f.launches()).toBe(2);
  expect(f.native.size).toBe(2);
  await outputContains(f, first.terminalId, 'test-ready>');
  await outputContains(f, second.terminalId, 'test-ready>');
  expect(f.native.claim(first.terminalId, 'view-one', f.native.runnerId).controlled).toBe(true);
  expect(f.native.claim(first.terminalId, 'view-two', f.native.runnerId).controlled).toBe(false);
  expect(() => f.native.input(first.terminalId, 'wrong', 'view-two')).toThrow('未取得');
  f.native.input(first.terminalId, "printf 'own:%s\\n' \"$PWD\"\r", 'view-one');
  await outputContains(f, first.terminalId, `own:${f.root}`);
  await f.native.resize(first.terminalId, 96, 32, 'view-one');
  f.native.input(first.terminalId, 'stty size\r', 'view-one');
  await outputContains(f, first.terminalId, '32 96');
  f.native.detach(first.terminalId, 'view-one');
  const restored = await f.native.attach(first.terminalId, f.native.runnerId);
  expect(restored.data).toContain(`own:${f.root}`);
  expect(restored).toMatchObject({ cols: 96, rows: 32 });
  expect(f.native.claim(first.terminalId, 'view-two', f.native.runnerId).controlled).toBe(true);
  expect((await f.native.attach(second.terminalId, f.native.runnerId)).data).not.toContain('own:');
  await f.native.stop(first.agentId, f.native.runnerId);
  expect(f.native.list().terminals.find((r) => r.agentId === first.agentId)).toMatchObject({ lifecycle: 'ended', reason: 'stopped' });
  expect(f.native.list().terminals.find((r) => r.agentId === second.agentId)?.lifecycle).toBe('running');
  expect((await f.native.start(f.command('one'))).lifecycle).toBe('ended');
  expect(f.launches()).toBe(2);
  expect(f.disposed()).toBe(1);
});

test('输入控制带持有人：换人与释放推 terminalControl，快照带当前状态，同一用户换窗口直接转移', async () => {
  const f = await fixture();
  const zhang = { userId: 'user-zhang', name: '张三' }, li = { userId: 'user-li', name: '李四' };
  const record = await f.native.start(f.command('shared'));
  await settled(f, 'shared');
  const controlEvents = () => f.events.filter((e) => e.kind === 'terminalControl');
  expect((await f.native.attach(record.terminalId, f.native.runnerId)).control).toEqual({ held: false, revision: 0 });
  expect(f.native.claim(record.terminalId, 'zhang-tab-1', f.native.runnerId, zhang)).toMatchObject({ controlled: true, control: { holder: zhang } });
  expect(f.native.claim(record.terminalId, 'li-tab', f.native.runnerId, li)).toMatchObject({ controlled: false, control: { held: true, holder: zhang } });
  expect(f.native.claim(record.terminalId, 'zhang-tab-2', f.native.runnerId, zhang).controlled).toBe(true);
  expect(() => f.native.input(record.terminalId, 'x', 'zhang-tab-1')).toThrow('未取得');
  expect((await f.native.attach(record.terminalId, f.native.runnerId)).control).toEqual({ held: true, holder: zhang, revision: 2 });
  f.native.detach(record.terminalId, 'zhang-tab-2');
  expect(controlEvents()).toEqual([
    { kind: 'terminalControl', terminalId: record.terminalId, runnerId: f.native.runnerId, control: { held: true, holder: zhang, revision: 1 } },
    { kind: 'terminalControl', terminalId: record.terminalId, runnerId: f.native.runnerId, control: { held: true, holder: zhang, revision: 2 } },
    { kind: 'terminalControl', terminalId: record.terminalId, runnerId: f.native.runnerId, control: { held: false, revision: 3 } },
  ]);
  expect(f.native.claim(record.terminalId, 'li-tab', f.native.runnerId, li)).toMatchObject({ controlled: true, control: { holder: li, revision: 4 } });
  await f.native.stop('shared', f.native.runnerId);
  expect(controlEvents()).toHaveLength(4);
});

test('配置冲突／Runner 替换不再 spawn', async () => {
  const f = await fixture();
  const command = f.command('one');
  await f.native.start(command);
  expect(() => f.native.start({ ...command, requestFingerprint: 'different' })).toThrow('其他 CLI 配置');
  expect(() => f.native.start({ ...f.command('two'), runnerId: crypto.randomUUID() })).toThrow('不会自动创建');
  await settled(f, 'one');
  expect(f.launches()).toBe(1);
});

// 任务运行时只部署到 Linux 镜像。macOS 没有 setsid，不能给后台作业提供同等的控制终端语义。
test.skipIf(process.platform !== 'linux')('Linux 任务镜像的真实 Ctrl+C 中断命令但保留终端进程', async () => {
  const f = await fixture();
  const first = await f.native.start(f.command('one'));
  await settled(f, 'one');
  f.native.claim(first.terminalId, 'view', f.native.runnerId);
  f.native.input(first.terminalId, "printf 'sleep-start\\n'; sleep 30\r", 'view');
  await outputContains(f, first.terminalId, 'sleep-start\r\n');
  f.native.input(first.terminalId, '\x03', 'view');
  await nextPrompt(f, first.terminalId);
  f.native.input(first.terminalId, "printf 'after-interrupt\\n'\r", 'view');
  await outputContains(f, first.terminalId, 'after-interrupt\r\n');
  expect(f.native.size).toBe(1);
  expect(f.launches()).toBe(1);
});

test('启动失败保留单窗失败记录并写一行 warn 日志，相同请求不重试进程；会话整体关闭停止所有窗口', async () => {
  const warnings: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  const f = await fixture({ logger: { ...noopLogger, warn: (message, fields) => { warnings.push({ message, ...(fields ? { fields } : {}) }); } } });
  const failed = await f.native.start(f.command('bad', { cwd: 'missing-directory' }));
  expect(failed).toMatchObject({ lifecycle: 'failed', reason: 'start-failed' });
  expect(failed.error).toBeTruthy();
  // 展开「查看执行容器日志」时要能看到失败原因（RFC-022 SP-05）：原因与名册里的一致。
  expect(warnings).toContainEqual({ message: 'native terminal start failed', fields: { agentId: 'bad', error: failed.error } });
  expect(await f.native.start(f.command('bad', { cwd: 'missing-directory' }))).toMatchObject({ lifecycle: 'failed' });
  expect(f.launches()).toBe(0);
  await f.native.start(f.command('one'));
  await f.native.start(f.command('two'));
  await f.native.closeAll();
  expect(f.native.size).toBe(0);
  expect(f.native.list().terminals.filter((r) => r.lifecycle === 'ended')).toHaveLength(2);
});

test('启动前步骤失败不创建进程，名册写明失败步骤并释放私有目录；准备中 stop 取消步骤', async () => {
  const f = await fixture();
  await f.native.start(f.command('hook-fails', { beforeStart: material([{ kind: 'script', stepId: 'bad', name: '坏脚本', language: 'shell', argv: [], timeoutMs: 10000, source: 'exit 3' }]) }));
  const failed = await settled(f, 'hook-fails', 'failed');
  expect(failed).toMatchObject({ reason: 'before-start-failed', beforeStart: { state: 'failed', failedStep: '坏脚本' } });
  expect(failed.error).toContain('步骤 bad');
  expect(await stat(f.beforeStart.runDirFor('hook-fails')).then(() => true, () => false)).toBe(false);
  await f.native.start(f.command('slow', { beforeStart: material([{ kind: 'script', stepId: 'wait', name: '等待', language: 'shell', argv: [], timeoutMs: 30000, source: 'sleep 30' }]) }));
  await Bun.sleep(300);
  await f.native.stop('slow', f.native.runnerId);
  expect(f.native.list().terminals.find((r) => r.agentId === 'slow')).toMatchObject({ lifecycle: 'ended', reason: 'stopped', beforeStart: { state: 'cancelled' } });
  expect(f.launches()).toBe(0);
});

test('RFC-022：启动中（启动前步骤还在跑）就能取得输入控制，好让 CLI 第一次查询终端时有窗口回答；输入与改尺寸仍要等进程拉起；结束后不能再取得', async () => {
  const f = await fixture();
  const record = await f.native.start(f.command('early', { beforeStart: material([{ kind: 'script', stepId: 'wait', name: '等待', language: 'shell', argv: [], timeoutMs: 30000, source: 'sleep 30' }]) }));
  expect(record.lifecycle).toBe('starting');
  expect(f.native.claim(record.terminalId, 'creator-view', f.native.runnerId)).toMatchObject({ controlled: true, control: { held: true } });
  expect(f.native.claim(record.terminalId, 'other-view', f.native.runnerId).controlled).toBe(false);
  expect(() => f.native.input(record.terminalId, 'x', 'creator-view')).toThrow('CLI 进程尚未运行或已经结束');
  await expect(f.native.resize(record.terminalId, 100, 30, 'creator-view')).rejects.toThrow('CLI 进程尚未运行或已经结束');
  await f.native.stop('early', f.native.runnerId);
  expect(() => f.native.claim(record.terminalId, 'creator-view', f.native.runnerId)).toThrow('CLI 进程尚未运行或已经结束');
  expect(f.launches()).toBe(0);
});

test('通用终端协议（RFC-006 C6、C16）：原样拉起档位二进制，CS_MCP_* 进进程环境，启动前步骤可用 {{mcp.*}}，不产生 Agent 动态', async () => {
  const f = await fixture({ realPrepare: true });
  const token = 'dev-session-token-native';
  const mcp = [{ name: 'operations', url: 'http://mcp-operations.svc/mcp', headers: { [IDENTITY_HEADERS.devSessionToken]: token } }];
  const beforeStart = material([{ kind: 'file', stepId: 'cfg', name: '写 CLI 配置', pathTemplate: '{{agent.home}}/.tool/token', format: 'text', mode: 0o600, existing: 'replace', contentTemplate: '{{mcp.token}}' }]);
  await f.native.start(f.command('term', { launch: launchSpec('terminal'), mcp, beforeStart, env: { PS1: 'term-ready> ' } }));
  const record = await settled(f, 'term');
  expect(record).toMatchObject({ protocol: 'terminal', profileRevision: 3 });
  expect(record.nativeSessionId).toBeUndefined();
  f.native.claim(record.terminalId, 'view', f.native.runnerId);
  f.native.input(record.terminalId, `printf 'ops=%s same=%s\\n' "$CS_MCP_OPERATIONS_URL" "$([ "$(cat "$HOME/.tool/token")" = "$CS_MCP_TOKEN" ] && echo yes)"\r`, 'view');
  await outputContains(f, record.terminalId, 'ops=http://mcp-operations.svc/mcp same=yes');
  expect(f.events.some((event) => event.kind === 'nativeActivity')).toBe(false);
  await f.native.stop('term', f.native.runnerId);
  expect(await stat(f.beforeStart.runDirFor('term')).then(() => true, () => false)).toBe(false);
});

// RFC-024：步骤条曾在进程拉起那一刻撤掉，CLI 还没画出界面，用户看到十来秒黑屏。Runner 按屏幕判定界面画出后才上报 ui.ready。
const uiStates = (f: Fixture, agentId: string) => f.events.flatMap((e) => (e.kind === 'nativeTerminal' && e.terminal.agentId === agentId && e.terminal.ui ? [{ lifecycle: e.terminal.lifecycle, ...e.terminal.ui }] : []));

async function uiReady(f: Fixture, agentId: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const ready = uiStates(f, agentId).find((ui) => ui.state === 'ready');
    if (ready) return ready;
    await Bun.sleep(10);
  }
  throw new Error(`${agentId} 没有上报界面就绪`);
}

test('RFC-024：进程拉起时记录带 ui.waiting；屏幕出现可见文字并静止后上报一次 ui.ready（screen）', async () => {
  const f = await fixture({ readinessLimits: { quietMs: 50, timeoutMs: 10_000, minVisible: 1 } });
  await f.native.start(f.command('ui-screen'));
  await settled(f, 'ui-screen');
  expect(uiStates(f, 'ui-screen')[0]).toEqual({ lifecycle: 'running', state: 'waiting' });
  const ready = await uiReady(f, 'ui-screen');
  expect(ready.by).toBe('screen');
  expect(Date.parse(ready.readyAt!)).not.toBeNaN();
  expect(f.native.list().terminals.find((r) => r.agentId === 'ui-screen')?.ui).toMatchObject({ state: 'ready', by: 'screen' });
  // 之后的输出不再改界面状态：只判一次。
  f.native.claim('terminal-ui-screen', 'view-1', f.native.runnerId);
  f.native.input('terminal-ui-screen', 'echo later\r', 'view-1');
  await outputContains(f, 'terminal-ui-screen', 'later');
  await Bun.sleep(120);
  expect(uiStates(f, 'ui-screen').filter((ui) => ui.state === 'ready')).toHaveLength(1);
});

test('RFC-024：CLI 一直不画可见文字，到超时按 timeout 放行', async () => {
  const f = await fixture({ readinessLimits: { quietMs: 50, timeoutMs: 200, minVisible: 1 }, cmd: ['sleep', '5'] });
  await f.native.start(f.command('ui-timeout'));
  await settled(f, 'ui-timeout');
  expect((await uiReady(f, 'ui-timeout')).by).toBe('timeout');
});

test('RFC-024：判定前进程就退出，不再上报 ui.ready（计时器已清）', async () => {
  const f = await fixture({ readinessLimits: { quietMs: 50, timeoutMs: 300, minVisible: 1 }, cmd: ['true'] });
  await f.native.start(f.command('ui-exit'));
  await settled(f, 'ui-exit', 'ended');
  await Bun.sleep(450);
  expect(uiStates(f, 'ui-exit').some((ui) => ui.state === 'ready')).toBe(false);
});

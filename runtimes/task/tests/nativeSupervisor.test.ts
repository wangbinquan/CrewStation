import { afterEach, expect, test } from 'bun:test';
import { chown, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerEvent, StartAgentTerminalCommand } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';
import { NativeTerminalSupervisor } from '../src/terminal/nativeSupervisor';
import { createNativePtyBackend } from '../src/terminal/nativePty';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-native-pty-'));
  if (probeCurrentUid() === 0) await chown(root, 10001, 10001);
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const isolation = resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) });
  const launcher = createProcessLauncher({ isolation, processEnv: process.env, workerHome: root, logger: noopLogger });
  const events: RunnerEvent[] = [];
  let launches = 0;
  let disposed = 0;
  const paths = await createWorkdirPaths(root);
  const native = new NativeTerminalSupervisor({
    backend: createNativePtyBackend(launcher), launcher, paths, agentEnv: {}, logger: noopLogger,
    emit: (e) => events.push(e),
    prepare: async (_spec, context) => {
      launches++;
      return { plan: { cmd: ['bash', '--noprofile', '--norc'], cwd: context.cwd, env: { ...context.env, PS1: 'test-ready> ' } }, dispose: () => { disposed++; } };
    },
  });
  cleanups.push(() => native.closeAll());
  const command = (id: string): StartAgentTerminalCommand => ({ id, type: 'startAgentTerminal', agentId: id, terminalId: `terminal-${id}`, runnerId: native.runnerId, requestFingerprint: id, compute: 'balanced', driver: 'claude-code', model: 'model', permission: 'edit', cols: 80, rows: 24, mcp: [], env: {} });
  return { native, command, root: paths.root, events, launches: () => launches, disposed: () => disposed };
}

async function outputContains(f: Awaited<ReturnType<typeof fixture>>, terminalId: string, text: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const data = f.events.filter((e) => e.kind === 'terminalOutput' && e.terminalId === terminalId).map((e) => e.kind === 'terminalOutput' ? e.data : '').join('');
    if (data.includes(text)) return;
    await Bun.sleep(10);
  }
  throw new Error(`未收到终端输出 ${text}`);
}

async function nextPrompt(f: Awaited<ReturnType<typeof fixture>>, terminalId: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const text = f.events.filter((e) => e.kind === 'terminalOutput' && e.terminalId === terminalId).map((e) => e.kind === 'terminalOutput' ? e.data : '').join('');
    if (text.split('test-ready> ').length >= 3) return;
    await Bun.sleep(10);
  }
  throw new Error('Ctrl+C 后没有回到 shell 提示');
}

test('真实 PTY 并发启动只建一进程；detach／attach 保留原进程，输入／resize 互不串窗，stop 只结束目标', async () => {
  const f = await fixture();
  const [first, duplicate, second] = await Promise.all([f.native.start(f.command('one')), f.native.start(f.command('one')), f.native.start(f.command('two'))]);
  expect(first.agentId).toBe(duplicate.agentId);
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

test('配置冲突／Runner 替换不再 spawn', async () => {
  const f = await fixture();
  const command = f.command('one');
  await f.native.start(command);
  expect(() => f.native.start({ ...command, requestFingerprint: 'different' })).toThrow('其他 CLI 配置');
  expect(() => f.native.start({ ...f.command('two'), runnerId: crypto.randomUUID() })).toThrow('不会自动创建');
  expect(f.launches()).toBe(1);
});

// 任务运行时只部署到 Linux 镜像。macOS 没有 setsid，不能给后台作业提供同等的控制终端语义。
test.skipIf(process.platform !== 'linux')('Linux 任务镜像的真实 Ctrl+C 中断命令但保留终端进程', async () => {
  const f = await fixture();
  const first = await f.native.start(f.command('one'));
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

test('启动失败保留单窗失败记录，相同请求不重试进程；会话整体关闭停止所有窗口', async () => {
  const f = await fixture();
  const failed = await f.native.start({ ...f.command('bad'), cwd: 'missing-directory' });
  expect(failed).toMatchObject({ lifecycle: 'failed', reason: 'start-failed' });
  expect(failed.error).toBeTruthy();
  await f.native.start(f.command('bad'));
  expect(f.launches()).toBe(0);
  await f.native.start(f.command('one'));
  await f.native.start(f.command('two'));
  await f.native.closeAll();
  expect(f.native.size).toBe(0);
  expect(f.native.list().terminals.filter((r) => r.lifecycle === 'ended')).toHaveLength(2);
});

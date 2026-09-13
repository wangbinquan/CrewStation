import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunnerResultPayloads, TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { createClaudeCodeCliDriver, createOpencodeCliDriver } from '../src/agents/cliDriver';
import type { DriverRegistry } from '../src/agents/registry';
import { createDriverRegistry } from '../src/agents/registry';
import { createStubDriver } from '../src/agents/stubDriver';
import { contentVersion } from '../src/files/fileCommands';
import type { FakeSession } from './fakeSession';
import { CommandFailure, startFakeSession } from './fakeSession';
import type { TestRunner } from './testRunner';
import { runningAsRoot, startTestRunner, TEST_TASK_ID, TEST_TOKEN, WORKER_ID } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 驱动注册表在测试里固定住：两个 CLI 一律按「二进制不在位」接入，hello 与错误码才不随开发机上装了什么而变。 */
function testDrivers(): DriverRegistry {
  const absent = { which: () => null };
  return createDriverRegistry([createStubDriver(), createClaudeCodeCliDriver(absent), createOpencodeCliDriver(absent)]);
}

async function boot(): Promise<{ session: FakeSession; tr: TestRunner }> {
  const session = startFakeSession();
  cleanups.push(() => session.stop());
  const tr = await startTestRunner(session.url, {}, { registry: testDrivers() });
  cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  return { session, tr };
}

async function expectFailure(promise: Promise<unknown>, code: string): Promise<CommandFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandFailure);
    expect((error as CommandFailure).code).toBe(code);
    return error as CommandFailure;
  }
  throw new Error(`期望失败 ${code}，实际成功`);
}

describe('握手与心跳', () => {
  test('原生名册与失败启动通过真实 WS 回包；关闭视图不会删除 CLI 记录', async () => {
    const { session } = await boot();
    const roster = RunnerResultPayloads.listAgentTerminals.parse(await session.call({ id: 'native-list', type: 'listAgentTerminals' }));
    expect(roster.terminals).toEqual([]);
    const result = await session.call({ id: 'native-start', type: 'startAgentTerminal', agentId: 'native-bad', terminalId: 'native-terminal', runnerId: roster.runnerId, requestFingerprint: 'start-one', driver: 'claude-code', compute: 'balanced', model: 'model', permission: 'edit', cwd: 'directory-that-does-not-exist', cols: 80, rows: 24 });
    expect(RunnerResultPayloads.startAgentTerminal.parse(result)).toMatchObject({ lifecycle: 'failed', reason: 'start-failed' });
    await session.call({ id: 'native-close-view', type: 'closeTerminal', terminalId: 'native-terminal' });
    expect(RunnerResultPayloads.listAgentTerminals.parse(await session.call({ id: 'native-list-again', type: 'listAgentTerminals' })).terminals).toHaveLength(1);
    expect(RunnerResultPayloads.attachTerminal.parse(await session.call({ id: 'native-attach', type: 'attachTerminal', terminalId: 'native-terminal', runnerId: roster.runnerId }))).toMatchObject({ data: '', throughSeq: 0 });
  });
  test('首帧 hello 合协议，welcome 后收到 seq=1 的 runnerState ready，ping 得到 pong，无效命令帧按 id 回 invalid_command', async () => {
    const { session, tr } = await boot();
    const hello = await session.waitFor(() => session.hellos[0]);
    expect(hello).toMatchObject({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: TEST_TASK_ID, runnerToken: TEST_TOKEN, workdir: tr.runner.workdir });
    expect(hello.capabilities.drivers).toEqual(['stub']);
    expect(hello.capabilities.preview).toBe(false);
    expect(typeof hello.capabilities.pty).toBe('boolean');
    const ready = await session.waitForEvent('runnerState');
    expect(ready.seq).toBe(1);
    expect(ready.event.state).toBe('ready');

    session.send({ type: 'ping', at: new Date().toISOString() });
    const pong = await session.waitFor(() => session.frames.find((f) => f.type === 'pong'));
    expect(pong?.type).toBe('pong');

    await expectFailure(session.call({ id: 'bad-1', type: 'format-disk' }), 'invalid_command');
    session.send({ type: 'nonsense' });
    await Bun.sleep(30);
    expect(tr.logLines.some((line) => line.includes(TEST_TOKEN))).toBe(false);
  });
});

describe('exec', () => {
  test('workspaceStatus 经真实 Runner 协议读取；非 Git 目录不可用，初始化后是尚无提交', async () => {
    const { session } = await boot();
    expect(RunnerResultPayloads.workspaceStatus.parse(await session.call({ id: 'ws-1', type: 'workspaceStatus' }))).toMatchObject({ status: 'unavailable' });
    const init = RunnerResultPayloads.exec.parse(await session.call({ id: 'ws-init', type: 'exec', execId: 'ws-init', command: ['git', 'init', '-b', 'main'], wait: true }));
    expect(init.exitCode).toBe(0);
    expect(RunnerResultPayloads.workspaceStatus.parse(await session.call({ id: 'ws-2', type: 'workspaceStatus' }))).toMatchObject({ status: 'ready', branch: 'main', headSha: null, uncommittedCount: 0 });
    const comparison = RunnerResultPayloads.compareWorkspace.parse(await session.call({ id: 'ws-3', type: 'compareWorkspace' }));
    expect(comparison.commits.status).toBe('undeployed');
    expect(RunnerResultPayloads.workspaceComparisonDetails.parse(await session.call({ id: 'ws-4', type: 'workspaceComparisonDetails', comparisonId: comparison.comparisonId, tab: 'uncommitted' }))).toMatchObject({ files: [], truncated: false });
  });
  test('输出分流、退出码与耗时；cwd 相对工作目录；超时与取消杀进程树；重复与未知 id 报错', async () => {
    const { session, tr } = await boot();
    expect(await session.call({ id: 'c1', type: 'exec', execId: 'x1', command: ['sh', '-c', 'echo out; echo err 1>&2; exit 3'] })).toEqual({});
    const exited = await session.waitForEvent('execExited', (e) => e.execId === 'x1');
    expect(exited.event.exitCode).toBe(3);
    expect(exited.event.durationMs).toBeGreaterThanOrEqual(0);
    const outputs = session.eventsOf('execOutput').filter((e) => e.event.execId === 'x1');
    expect(outputs.filter((e) => e.event.stream === 'stdout').map((e) => e.event.data).join('')).toBe('out\n');
    expect(outputs.filter((e) => e.event.stream === 'stderr').map((e) => e.event.data).join('')).toBe('err\n');
    expect(outputs.every((o) => o.seq < exited.seq)).toBe(true);

    await mkdir(join(tr.workdir, 'sub'));
    await session.call({ id: 'c2', type: 'exec', execId: 'x2', command: ['pwd'], cwd: 'sub' });
    await session.waitForEvent('execExited', (e) => e.execId === 'x2');
    expect(session.eventsOf('execOutput').find((e) => e.event.execId === 'x2')?.event.data.trim().endsWith('/sub')).toBe(true);

    await session.call({ id: 'c3', type: 'exec', execId: 'x3', command: ['sh', '-c', 'sleep 30 & wait'], timeoutSeconds: 1 });
    const timedOut = await session.waitForEvent('execExited', (e) => e.execId === 'x3', 8000);
    expect(timedOut.event.exitCode).toBeNull();

    await session.call({ id: 'c4', type: 'exec', execId: 'x4', command: ['sleep', '30'] });
    await session.call({ id: 'c5', type: 'cancelExec', execId: 'x4' });
    expect((await session.waitForEvent('execExited', (e) => e.execId === 'x4')).event.exitCode).toBeNull();

    await session.call({ id: 'c6', type: 'exec', execId: 'x5', command: ['sleep', '5'] });
    await expectFailure(session.call({ id: 'c7', type: 'exec', execId: 'x5', command: ['true'] }), 'exec_exists');
    await session.call({ id: 'c8', type: 'cancelExec', execId: 'x5' });
    await expectFailure(session.call({ id: 'c9', type: 'cancelExec', execId: 'nope' }), 'not_found');
    await expectFailure(session.call({ id: 'c10', type: 'exec', execId: 'x6', command: ['true'], cwd: '../..' }), 'path_denied');
    await expectFailure(session.call({ id: 'c11', type: 'exec', execId: 'x7', command: ['definitely-not-a-binary-cs'] }), 'spawn_failed');
  }, 20_000);

  test('wait=true：进程结束后一次性回 stdout／stderr／退出码，仍发 execExited，不发 execOutput；输出按 256 KiB 截断；超时给 null', async () => {
    const { session } = await boot();
    const result = RunnerResultPayloads.exec.parse(await session.call({ id: 'w1', type: 'exec', execId: 'w-1', command: ['sh', '-c', 'echo out; echo err 1>&2; exit 5'], wait: true }));
    expect(result).toEqual({ execId: 'w-1', exitCode: 5, stdout: 'out\n', stderr: 'err\n', durationMs: result.durationMs, truncated: false });
    expect(session.eventsOf('execExited').find((e) => e.event.execId === 'w-1')?.event.exitCode).toBe(5);
    expect(session.eventsOf('execOutput').some((e) => e.event.execId === 'w-1')).toBe(false);
    const resultFrame = session.frames.findIndex((f) => f.type === 'result' && f.id === 'w1');
    const exitedFrame = session.frames.findIndex((f) => f.type === 'event' && f.event.kind === 'execExited' && f.event.execId === 'w-1');
    expect(exitedFrame).toBeLessThan(resultFrame);

    const big = RunnerResultPayloads.exec.parse(await session.call({ id: 'w2', type: 'exec', execId: 'w-2', command: ['sh', '-c', 'head -c 300000 /dev/zero | tr "\\0" a; echo tail 1>&2'], wait: true }, 10_000));
    expect(big.stdout).toHaveLength(256 * 1024);
    expect(big.stderr).toBe('tail\n');
    expect(big.truncated).toBe(true);
    expect(big.exitCode).toBe(0);

    const timedOut = RunnerResultPayloads.exec.parse(await session.call({ id: 'w3', type: 'exec', execId: 'w-3', command: ['sh', '-c', 'echo partial; sleep 30'], wait: true, timeoutSeconds: 1 }, 10_000));
    expect(timedOut.exitCode).toBeNull();
    expect(timedOut.stdout).toBe('partial\n');
  }, 30_000);
});

describe('文件', () => {
  test('写读一致、版本为 sha256、版本冲突、目录列表、fileChanged 事件', async () => {
    const { session } = await boot();
    const written = RunnerResultPayloads.writeFile.parse(await session.call({ id: 'f1', type: 'writeFile', path: 'notes/a.txt', content: 'hello' }));
    expect(written).toEqual({ path: 'notes/a.txt', version: contentVersion(Buffer.from('hello')) });
    const read = RunnerResultPayloads.readFile.parse(await session.call({ id: 'f2', type: 'readFile', path: './notes/a.txt' }));
    expect(read).toEqual({ path: 'notes/a.txt', content: 'hello', version: written.version, size: 5 });
    await expectFailure(session.call({ id: 'f3', type: 'writeFile', path: 'notes/a.txt', content: 'x', expectedVersion: 'stale' }), 'version_conflict');
    const second = RunnerResultPayloads.writeFile.parse(await session.call({ id: 'f4', type: 'writeFile', path: 'notes/a.txt', content: 'hello again', expectedVersion: written.version }));
    expect(second.version).toBe(contentVersion(Buffer.from('hello again')));
    await expectFailure(session.call({ id: 'f5', type: 'writeFile', path: 'brand-new.txt', content: 'x', expectedVersion: written.version }), 'version_conflict');
    const root = RunnerResultPayloads.listFiles.parse(await session.call({ id: 'f6', type: 'listFiles' }));
    expect(root.path).toBe('.');
    expect(root.entries.find((e) => e.name === 'notes')).toMatchObject({ kind: 'dir' });
    const notes = RunnerResultPayloads.listFiles.parse(await session.call({ id: 'f7', type: 'listFiles', path: 'notes/' }));
    expect(notes.entries).toHaveLength(1);
    expect(notes.entries[0]).toMatchObject({ name: 'a.txt', kind: 'file', size: 11 });
    expect(session.eventsOf('fileChanged').map((e) => e.event.path)).toEqual(['notes/a.txt', 'notes/a.txt']);
    await expectFailure(session.call({ id: 'f8', type: 'readFile', path: 'missing.txt' }), 'not_found');
    await expectFailure(session.call({ id: 'f9', type: 'readFile', path: 'notes' }), 'is_directory');
    await expectFailure(session.call({ id: 'f10', type: 'listFiles', path: 'notes/a.txt' }), 'not_a_directory');
  });

  test('绝对路径、.. 与符号链接逃逸一律 path_denied', async () => {
    const { session, tr } = await boot();
    const outside = join(tmpdir(), `cs-outside-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'top secret');
    cleanups.push(() => Bun.$`rm -rf ${outside}`.quiet().then(() => undefined));
    await symlink(outside, join(tr.workdir, 'escape'));
    await symlink(join(outside, 'secret.txt'), join(tr.workdir, 'secret-link'));

    await expectFailure(session.call({ id: 'p1', type: 'readFile', path: '../etc/hosts' }), 'path_denied');
    await expectFailure(session.call({ id: 'p2', type: 'readFile', path: '/etc/hosts' }), 'path_denied');
    await expectFailure(session.call({ id: 'p3', type: 'writeFile', path: 'x/../../evil.txt', content: 'no' }), 'path_denied');
    await expectFailure(session.call({ id: 'p4', type: 'readFile', path: 'escape/secret.txt' }), 'path_denied');
    await expectFailure(session.call({ id: 'p5', type: 'readFile', path: 'secret-link' }), 'path_denied');
    await expectFailure(session.call({ id: 'p6', type: 'writeFile', path: 'escape/new-dir/new.txt', content: 'no' }), 'path_denied');
    await expectFailure(session.call({ id: 'p7', type: 'listFiles', path: 'escape' }), 'path_denied');
    await expectFailure(session.call({ id: 'p8', type: 'listFiles', path: '..' }), 'path_denied');
    await stat(join(outside, 'secret.txt'));
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('top secret');
    const listed = RunnerResultPayloads.listFiles.parse(await session.call({ id: 'p9', type: 'listFiles', path: '.' }));
    expect(listed.entries.find((e) => e.name === 'escape')?.kind).toBe('symlink');
  });
});

describe('stub Agent', () => {
  test('oneshot：started → session → 回显 text → completed，mcp 名与 env 键被记录', async () => {
    const { session } = await boot();
    const prompt = 'hello stub world';
    const command = { id: 'a1', type: 'startAgent', agentId: 'agent-1', compute: 'sample-stub', driver: 'stub', model: 'stub/echo', permission: 'edit', mode: 'oneshot', initialPrompt: prompt, mcp: [{ name: 'ops', url: 'http://ops.svc.cs.internal/mcp' }], env: { STUB_TEST_KEY: 'value-must-not-be-logged' } };
    expect(await session.call(command)).toEqual({});
    await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-1' && e.event.type === 'completed');
    const events = session.eventsOf('agent').map((e) => e.event.event).filter((e) => e.agentId === 'agent-1');
    expect(events.map((e) => e.type).slice(0, 2)).toEqual(['started', 'session']);
    expect(events.at(-1)?.type).toBe('completed');
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe(prompt);
    expect(events.every((e, i) => e.seq === i + 1)).toBe(true);
    expect(events[0]?.raw).toMatchObject({ mode: 'oneshot', model: 'stub/echo', mcp: ['ops'] });
    expect((events[0]?.raw as { envKeys: string[] }).envKeys).toContain('STUB_TEST_KEY');
    expect((events[0]?.raw as { envKeys: string[] }).envKeys).not.toContain('CS_RUNNER_TOKEN');
    expect(events[1]?.sessionId).toBe('stub-agent-1');
    expect(events.at(-1)?.result).toMatchObject({ summary: `echoed ${prompt.length} chars`, exitCode: 0 });
    await expectFailure(session.call({ id: 'a2', type: 'startAgent', agentId: 'agent-x', compute: 'sample-stub', driver: 'stub', model: 'm', permission: 'edit', mode: 'oneshot', cwd: '../outside' }), 'path_denied');
  });

  test('interactive：WRITE 指令以 worker 身份落盘，sendMessage 回显，cancelAgent 结束', async () => {
    const { session, tr } = await boot();
    const start = { id: 'b1', type: 'startAgent', agentId: 'agent-2', compute: 'sample-stub', driver: 'stub', model: 'stub/echo', permission: 'full', mode: 'interactive', initialPrompt: 'WRITE out/hello.txt: written by stub' };
    await session.call(start);
    await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-2' && e.event.type === 'status' && e.event.status === 'waiting');
    const file = join(tr.workdir, 'out', 'hello.txt');
    expect(await readFile(file, 'utf8')).toBe('written by stub');
    if (runningAsRoot) expect((await stat(file)).uid).toBe(WORKER_ID);
    const tools = session.eventsOf('agent').map((e) => e.event.event).filter((e) => e.agentId === 'agent-2' && e.type.startsWith('tool-'));
    expect(tools.map((t) => t.type)).toEqual(['tool-start', 'tool-end']);
    expect(tools[1]?.tool?.isError).toBe(false);

    await expectFailure(session.call({ ...start, id: 'b2-dup' }), 'agent_exists');
    await session.call({ id: 'b3', type: 'sendMessage', agentId: 'agent-2', content: 'second turn' });
    const texts = session.eventsOf('agent').map((e) => e.event.event).filter((e) => e.agentId === 'agent-2' && e.type === 'text');
    expect(texts.map((t) => t.text).join('')).toBe('WRITE out/hello.txt: written by stubsecond turn');
    await expectFailure(session.call({ id: 'b4', type: 'sendMessage', agentId: 'ghost', content: 'x' }), 'not_found');

    await session.call({ id: 'b5', type: 'cancelAgent', agentId: 'agent-2' });
    await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-2' && e.event.type === 'cancelled');
    await expectFailure(session.call({ id: 'b6', type: 'sendMessage', agentId: 'agent-2', content: 'too late' }), 'not_found');
    expect(tr.logLines.some((line) => line.includes('written by stub'))).toBe(false);
  });

  test('CLI 驱动：二进制不在位时报 driver_not_installed，不白建运行目录', async () => {
    const { session } = await boot();
    await session.call({ id: 'd1', type: 'startAgent', agentId: 'agent-3', compute: 'sample-stub', driver: 'claude-code', model: 'anthropic/claude-sonnet-4', permission: 'edit', mode: 'oneshot', initialPrompt: 'hi' });
    const failure = await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-3' && e.event.type === 'error');
    expect(failure.event.event.error?.code).toBe('driver_not_installed');
    expect(failure.event.event.error?.message).toBe('driver binary not installed: claude');
    await Bun.sleep(20);
    await expectFailure(session.call({ id: 'd2', type: 'cancelAgent', agentId: 'agent-3' }), 'not_found');
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunnerResultPayloads } from '@crewstation/contracts';
import { echoDriverFactory } from './echoAgentDriver';
import type { FakeSession } from './fakeSession';
import { CommandFailure, startFakeSession } from './fakeSession';
import { profileFields } from './profileFixtures';
import type { TestRunner } from './testRunner';
import { freePort, startTestRunner, TEST_SUBTASK_ID } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function boot(overrides: Parameters<typeof startTestRunner>[1] = {}): Promise<{ session: FakeSession; tr: TestRunner }> {
  const session = startFakeSession();
  cleanups.push(() => session.stop());
  const tr = await startTestRunner(session.url, overrides, { drivers: echoDriverFactory() });
  cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  return { session, tr };
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof CommandFailure ? error.code : 'not-a-command-failure';
  }
}

describe('预览监督', () => {
  test('启动 → starting → ready；restartPreview 重来；previewStatus 正确', async () => {
    const port = freePort();
    const { session } = await boot({ preview: { command: ['bun', '-e', `Bun.serve({ port: ${port}, fetch: () => new Response('ok') })`], port, healthPath: '/healthz' } });
    expect(session.hellos[0]?.capabilities.preview).toBe(true);
    await session.waitForEvent('previewState', (e) => e.state === 'ready', 15_000);
    expect(session.eventsOf('previewState').map((e) => e.event.state)).toEqual(['starting', 'ready']);
    expect(RunnerResultPayloads.previewStatus.parse(await session.call({ id: 'v1', type: 'previewStatus' }))).toEqual({ state: 'ready', port, restarts: 0 });

    expect(await session.call({ id: 'v2', type: 'restartPreview' })).toEqual({});
    await session.waitFor(() => (session.eventsOf('previewState').filter((e) => e.event.state === 'ready').length >= 2 ? true : undefined), 15_000, 'second ready');
    expect(session.eventsOf('previewState').map((e) => e.event.state)).toEqual(['starting', 'ready', 'starting', 'ready']);
    const status = RunnerResultPayloads.previewStatus.parse(await session.call({ id: 'v3', type: 'previewStatus' }));
    expect(status).toMatchObject({ state: 'ready', restarts: 0 });
  }, 40_000);

  test('反复崩溃：按退避重启到上限后 crashed，lastError 带退出码', async () => {
    const { session } = await boot({ preview: { command: ['sh', '-c', 'exit 7'], port: 65000, healthPath: '/' }, previewPolicy: { maxRestarts: 2, baseDelayMs: 10, pollIntervalMs: 20, probeTimeoutMs: 200 } });
    await session.waitForEvent('previewState', (e) => e.state === 'crashed', 10_000);
    const status = RunnerResultPayloads.previewStatus.parse(await session.call({ id: 'v4', type: 'previewStatus' }));
    expect(status).toEqual({ state: 'crashed', port: 65000, restarts: 2, lastError: 'exited with code 7' });
    expect(session.eventsOf('previewState').filter((e) => e.event.state === 'starting')).toHaveLength(3);
  }, 20_000);

  test('未配置预览：状态 disabled，restartPreview 报 preview_disabled', async () => {
    const { session } = await boot();
    expect(await session.call({ id: 'v5', type: 'previewStatus' })).toEqual({ state: 'disabled', restarts: 0 });
    expect(await failureCode(session.call({ id: 'v6', type: 'restartPreview' }))).toBe('preview_disabled');
  });
});

describe('verifyContract', () => {
  test('缺失文件、非法 JSON、JSON Schema 校验与逃逸路径', async () => {
    const { session, tr } = await boot();
    await mkdir(join(tr.workdir, 'out'), { recursive: true });
    await mkdir(join(tr.workdir, 'contracts'), { recursive: true });
    await writeFile(join(tr.workdir, 'out', 'result.json'), JSON.stringify({ score: 'high' }));
    await writeFile(join(tr.workdir, 'out', 'broken.json'), '{ not json');
    await writeFile(join(tr.workdir, 'contracts', 'result.schema.json'), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['score', 'summary'],
      properties: { score: { type: 'number' }, summary: { type: 'string' } },
    }));
    const base = { type: 'verifyContract', subtaskId: TEST_SUBTASK_ID } as const;
    const first = RunnerResultPayloads.verifyContract.parse(await session.call({ id: 'k1', ...base, contract: { name: 'report', required: ['out/result.json', 'out/missing.txt', 'out/broken.json'], schema: 'contracts/result.schema.json' } }));
    expect(first.ok).toBe(false);
    expect(first.missing).toEqual(['out/missing.txt']);
    expect(first.schemaErrors.some((e) => e.startsWith('out/result.json:') && e.includes('summary'))).toBe(true);
    expect(first.schemaErrors.some((e) => e.startsWith('out/result.json:') && e.includes('/score'))).toBe(true);
    expect(first.schemaErrors.some((e) => e.startsWith('out/broken.json: invalid JSON'))).toBe(true);

    await writeFile(join(tr.workdir, 'out', 'result.json'), JSON.stringify({ score: 0.9, summary: 'fine' }));
    await writeFile(join(tr.workdir, 'out', 'missing.txt'), 'present now');
    const second = RunnerResultPayloads.verifyContract.parse(await session.call({ id: 'k2', ...base, contract: { name: 'report', required: ['out/result.json', 'out/missing.txt'], schema: 'contracts/result.schema.json' } }));
    expect(second).toEqual({ ok: true, missing: [], schemaErrors: [] });

    const noSchema = RunnerResultPayloads.verifyContract.parse(await session.call({ id: 'k3', ...base, contract: { name: 'plain', required: ['out/result.json'] } }));
    expect(noSchema.ok).toBe(true);
    const badSchema = RunnerResultPayloads.verifyContract.parse(await session.call({ id: 'k4', ...base, contract: { name: 'plain', required: ['out/result.json'], schema: 'contracts/nope.json' } }));
    expect(badSchema.ok).toBe(false);
    expect(badSchema.schemaErrors).toEqual(['schema contracts/nope.json: file not found']);
    const scoped = RunnerResultPayloads.verifyContract.parse(await session.call({ id: 'k5', ...base, cwd: 'out', contract: { name: 'scoped', required: ['result.json', 'absent.json'] } }));
    expect(scoped.missing).toEqual(['absent.json']);
    expect(await failureCode(session.call({ id: 'k6', ...base, contract: { name: 'escape', required: ['../../etc/passwd'] } }))).toBe('path_denied');
  });
});

describe('终端', () => {
  test('真实 shell：输入回显、resize 生效（原生 PTY）、关闭后 terminalClosed', async () => {
    const { session, tr } = await boot();
    if (!session.hellos[0]?.capabilities.pty) {
      expect(await failureCode(session.call({ id: 't0', type: 'openTerminal', terminalId: 't1', cols: 80, rows: 24 }))).toBe('pty_unavailable');
      return;
    }
    expect(await session.call({ id: 't1', type: 'openTerminal', terminalId: 'term-1', cols: 80, rows: 24 })).toEqual({});
    expect(await failureCode(session.call({ id: 't2', type: 'openTerminal', terminalId: 'term-1', cols: 80, rows: 24 }))).toBe('terminal_exists');
    const output = (): string => session.eventsOf('terminalOutput').filter((e) => e.event.terminalId === 'term-1').map((e) => e.event.data).join('');
    await session.call({ id: 't3', type: 'terminalInput', terminalId: 'term-1', data: 'echo term-$((20+22))\n' });
    await session.waitFor(() => (output().includes('term-42') ? true : undefined), 15_000, 'echo output');
    await session.call({ id: 't4', type: 'terminalResize', terminalId: 'term-1', cols: 120, rows: 40 });
    await session.call({ id: 't5', type: 'terminalInput', terminalId: 'term-1', data: 'stty size\n' });
    const isNative = tr.logLines.some((line) => line.includes('"backend":"native"'));
    if (isNative) await session.waitFor(() => (output().includes('40 120') ? true : undefined), 15_000, 'resized stty size');
    expect(await failureCode(session.call({ id: 't6', type: 'terminalInput', terminalId: 'ghost', data: 'x' }))).toBe('not_found');
    expect(await session.call({ id: 't7', type: 'closeTerminal', terminalId: 'term-1' })).toEqual({});
    const closed = await session.waitForEvent('terminalClosed', (e) => e.terminalId === 'term-1', 15_000);
    expect(closed.event.terminalId).toBe('term-1');
    expect(await failureCode(session.call({ id: 't8', type: 'closeTerminal', terminalId: 'term-1' }))).toBe('not_found');
  }, 60_000);
});

describe('shutdown', () => {
  test('回 ack，runnerState draining，取消 Agent、关终端，然后 exit(0)', async () => {
    const { session, tr } = await boot();
    await session.call({ id: 's1', type: 'startAgent', agentId: 'agent-s', ...profileFields('agent-s'), mode: 'interactive', initialPrompt: 'stay' });
    await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-s' && e.event.type === 'status');
    if (session.hellos[0]?.capabilities.pty) await session.call({ id: 's2', type: 'openTerminal', terminalId: 'term-s', cols: 80, rows: 24 });
    expect(await session.call({ id: 's3', type: 'shutdown', graceSeconds: 10 })).toEqual({});
    // 尾部事件经 socket 传到假 session 端要一个来回：先等它们到达，再断言退出码。
    await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-s' && e.event.type === 'cancelled');
    if (session.hellos[0]?.capabilities.pty) await session.waitForEvent('terminalClosed', (e) => e.terminalId === 'term-s');
    await session.waitFor(() => (tr.exitCodes.length > 0 ? true : undefined), 15_000, 'exit hook');
    expect(tr.exitCodes).toEqual([0]);
    const states = session.eventsOf('runnerState').map((e) => e.event.state);
    expect(states[0]).toBe('ready');
    expect(states).toContain('draining');
    expect(session.eventsOf('agent').some((e) => e.event.event.agentId === 'agent-s' && e.event.event.type === 'cancelled')).toBe(true);
    if (session.hellos[0]?.capabilities.pty) expect(session.eventsOf('terminalClosed').some((e) => e.event.terminalId === 'term-s')).toBe(true);
    expect(await failureCode(session.call({ id: 's4', type: 'previewStatus' }, 500)).catch(() => 'no-reply')).not.toBe('no-error');
  }, 30_000);
});

describe('重连与重放', () => {
  test('cs-session 断开后在同一端口重开：hello 重发，seq > resumeFromSeq 的事件按序补发，无重复无缺口', async () => {
    const first = startFakeSession();
    cleanups.push(() => first.stop());
    const tr = await startTestRunner(first.url);
    cleanups.push(() => tr.dispose());
    await tr.runner.whenConnected();
    await first.call({ id: 'r1', type: 'exec', execId: 'quick', command: ['echo', 'before'] });
    await first.waitForEvent('execExited', (e) => e.execId === 'quick');
    await first.call({ id: 'r2', type: 'exec', execId: 'late', command: ['sh', '-c', 'sleep 0.4; echo late-output'] });
    const seenByFirst = Math.max(...first.events().map((e) => e.seq));
    first.stop();

    const second = startFakeSession({ port: first.port, resumeFromSeq: () => seenByFirst });
    cleanups.push(() => second.stop());
    await second.waitFor(() => second.hellos[0], 10_000, 'second hello');
    const late = await second.waitForEvent('execExited', (e) => e.execId === 'late', 10_000);
    expect(late.event.exitCode).toBe(0);
    const replayed = second.events();
    expect(replayed.length).toBeGreaterThanOrEqual(2);
    expect(replayed[0]?.seq).toBe(seenByFirst + 1);
    expect(replayed.every((e, i) => i === 0 || e.seq === (replayed[i - 1]?.seq ?? 0) + 1)).toBe(true);
    expect(replayed.some((e) => e.event.kind === 'execOutput' && e.event.data.includes('late-output'))).toBe(true);
    expect(replayed.some((e) => e.seq <= seenByFirst)).toBe(false);
    expect(await second.call({ id: 'r3', type: 'listFiles' })).toMatchObject({ path: '.' });
    expect(tr.runner.link.welcomed).toBe(true);
  }, 20_000);

  test('welcome resumeFromSeq=0 时全量补发（含 ready），且事件在断线期间照常入缓冲', async () => {
    const first = startFakeSession();
    cleanups.push(() => first.stop());
    const tr = await startTestRunner(first.url);
    cleanups.push(() => tr.dispose());
    await tr.runner.whenConnected();
    const seqBefore = tr.runner.link.lastSeq;
    first.stop();
    await Bun.sleep(30);
    tr.runner.link.emit({ kind: 'fileChanged', path: 'offline.txt' });
    expect(tr.runner.link.lastSeq).toBe(seqBefore + 1);
    const second = startFakeSession({ port: first.port });
    cleanups.push(() => second.stop());
    await second.waitForEvent('fileChanged', (e) => e.path === 'offline.txt', 10_000);
    expect(second.events().map((e) => e.seq)).toEqual(Array.from({ length: seqBefore + 1 }, (_, i) => i + 1));
  }, 20_000);
});

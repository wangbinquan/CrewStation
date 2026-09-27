import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, chown, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonLogger } from '@crewstation/kernel';
import { BusinessExecSupervisor, businessExecDigest } from '../src/exec/businessExecSupervisor';
import type { BusinessExecInput } from '../src/exec/businessExecSupervisor';
import { ExecutionJournal } from '../src/exec/executionJournal';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function boot(limits = { outputBytes: 65536, spoolBytes: 262144, eventBytes: 65536 }) {
  const workdir = await mkdtemp(join(tmpdir(), 'cs-business-command-work-'));
  const directory = await mkdtemp(join(tmpdir(), 'cs-business-command-journal-'));
  if (process.getuid?.() === 0) { await chown(workdir, 10001, 10001); await chmod(workdir, 0o755); }
  const lines: string[] = [], logger = createJsonLogger({ service: 'business-command-test' }, (line) => lines.push(line));
  const journal = new ExecutionJournal(directory, 'incarnation-a', limits);
  const launcher = createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) }), processEnv: process.env, workerHome: workdir, logger });
  const supervisor = new BusinessExecSupervisor({ journal, launcher, paths: await createWorkdirPaths(workdir), logger });
  cleanups.push(async () => { await supervisor.drain(); journal.close(); await rm(workdir, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); });
  return { supervisor, journal, workdir, directory, lines, launcher, logger };
}
function command(script: string, overrides: Partial<BusinessExecInput> = {}): BusinessExecInput {
  const input = { executionId: 'execution-test', attempt: 1, command: ['sh', '-c', script], env: {}, timeoutSeconds: 30, ...overrides };
  return { ...input, payloadDigest: businessExecDigest(input) };
}

describe('business command durable supervisor', () => {
  test('保留环境与 NUL 在持久准入前拒绝，不静默过滤也不 spawn', async () => {
    const { supervisor, journal } = await boot();
    for (const name of ['CS_RUNNER_TOKEN', 'CS_DATABASE_URL', 'HOME', 'PATH', 'XDG_CONFIG_HOME', 'LD_PRELOAD', 'OPENAI_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENCODE_CONFIG']) {
      const input = command('exit 0', { executionId: name, env: { [name]: 'must-not-log' } });
      await expect(supervisor.start(input)).rejects.toMatchObject({ code: 'invalid_configuration' });
      expect(journal.get(name)).toBeUndefined();
    }
    await expect(supervisor.start(command('true', { env: { SAFE: 'nul\0value' } }))).rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(journal.get('execution-test')).toBeUndefined();
    const input = command('printf %s "$BUSINESS_VALUE"', { env: { BUSINESS_VALUE: 'passed-through' } });
    await supervisor.start(input); await supervisor.settled(input.executionId);
    expect(journal.replay(input.executionId, 0).filter((e) => e.frame.type === 'output').map((e) => e.frame.type === 'output' ? e.frame.text : '').join('')).toBe('passed-through');
  });
  test('持久取消墓碑先于延迟 start 到达，不会启动副作用', async () => {
    const { supervisor, journal, workdir } = await boot();
    const input = command('touch forbidden-side-effect');
    const cancelled = await supervisor.cancelRegistered(input);
    expect(cancelled).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
    expect(await supervisor.start(input)).toEqual(cancelled);
    expect(await supervisor.cancelRegistered(input)).toEqual(cancelled);
    await expect(readFile(join(workdir, 'forbidden-side-effect'))).rejects.toThrow();
    expect(journal.replay(input.executionId, 0)).toHaveLength(1);
    await expect(supervisor.cancelRegistered({ ...input, payloadDigest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'execution_conflict' });
  });

  test('90 秒命令立即返回 running，超过旧 30 秒回执期限仍保留首尾输出', async () => {
    const { supervisor, journal } = await boot();
    const input = command('printf START; sleep 90; printf END', { timeoutSeconds: 120 });
    const before = Date.now();
    expect((await supervisor.start(input)).phase).toBe('running');
    expect(Date.now() - before).toBeLessThan(5000);
    const receipt = await supervisor.settled(input.executionId);
    expect(receipt).toMatchObject({ phase: 'finished', result: { exitCode: 0, reason: 'exited' } });
    expect(receipt.result!.durationMs).toBeGreaterThanOrEqual(90_000);
    expect(journal.replay(input.executionId, 0).flatMap(({ frame }) => frame.type === 'output' ? [frame.text] : []).join('')).toBe('STARTEND');
  }, 120_000);

  test('并发重发只 spawn 一次，RPC 受理时还未结束，输出尾部先于终态水位', async () => {
    const { supervisor, journal, workdir } = await boot();
    const input = command('echo run >> runs; printf start; sleep 0.15; printf end; printf err >&2');
    const receipts = await Promise.all(Array.from({ length: 8 }, () => supervisor.start(input)));
    expect(receipts.every((r) => r.phase === 'running')).toBe(true);
    expect(journal.get(input.executionId)?.result).toBeNull();
    const done = await supervisor.settled(input.executionId);
    expect(done).toMatchObject({ phase: 'finished', result: { exitCode: 0, reason: 'exited' } });
    const events = journal.replay(input.executionId, 0);
    expect(events.at(-1)).toMatchObject({ sequence: done.lastSequence, frame: { type: 'result' } });
    const output = (stream: string) => events.flatMap(({ frame }) => frame.type === 'output' && frame.stream === stream ? [frame.text] : []).join('');
    expect(output('stdout')).toBe('startend'); expect(output('stderr')).toBe('err');
    expect(await supervisor.start(input)).toEqual(done);
    expect(await readFile(join(workdir, 'runs'), 'utf8')).toBe('run\n');
  });

  test('未知旧 incarnation 不按 PID 恢复，不重复命令；不兼容摘要拒绝', async () => {
    const fixture = await boot();
    const input = command('touch should-not-exist');
    fixture.journal.reserve(input);
    const replacementJournal = new ExecutionJournal(fixture.directory, 'replacement', { outputBytes: 65536, spoolBytes: 262144, eventBytes: 65536 });
    try {
      const replacement = new BusinessExecSupervisor({ ...fixture, journal: replacementJournal, paths: await createWorkdirPaths(fixture.workdir) });
      expect((await replacement.start(input)).phase).toBe('unknown');
      await expect(replacement.cancel(input.executionId)).rejects.toThrow('无法证明');
      await expect(readFile(join(fixture.workdir, 'should-not-exist'))).rejects.toThrow();
      await expect(replacement.start({ ...input, env: { CHANGED: 'yes' } })).rejects.toThrow('摘要');
      await expect(replacement.start(command('echo changed'))).rejects.toThrow('不同');
    } finally { replacementJournal.close(); }
  });

  test('取消直到进程退出才终态，已完成成功不被迟到取消覆盖', async () => {
    const { supervisor, journal } = await boot();
    const input = command('exec sleep 20');
    await supervisor.start(input);
    const result = await supervisor.cancel(input.executionId);
    expect(result).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
    expect(journal.replay(input.executionId, 0).some(({ frame }) => frame.type === 'state' && frame.state === 'cancelling')).toBe(true);
    const next = command('printf done', { executionId: 'success' });
    await supervisor.start(next); const complete = await supervisor.settled(next.executionId);
    expect(await supervisor.cancel(next.executionId)).toEqual(complete);
    expect(complete.result?.reason).toBe('exited');
  });

  test('超时结束、spawn 失败留回执，参数与日志不泄露 env 内容', async () => {
    const { supervisor, lines } = await boot();
    const timeout = command('exec sleep 20', { timeoutSeconds: 1, env: { PRIVATE_VALUE: 'sentinel-secret-never-print' } });
    await supervisor.start(timeout);
    expect((await supervisor.settled(timeout.executionId)).result?.reason).toBe('timeout');
    const missing = command('', { executionId: 'missing', command: ['cs-command-does-not-exist'] });
    expect(await supervisor.start(missing)).toMatchObject({ phase: 'finished', result: { reason: 'spawn_failed', exitCode: null } });
    await expect(supervisor.start(command('', { executionId: 'bad', timeoutSeconds: 0 }))).rejects.toThrow('无效');
    await expect(supervisor.cancel('no-such-execution')).rejects.toThrow('不存在');
    expect(lines.join('\n')).not.toContain('sentinel-secret-never-print');
    expect(businessExecDigest(command('echo', { env: { B: '2', A: '1' } }))).toBe(businessExecDigest(command('echo', { env: { A: '1', B: '2' } })));
  });

  test('输出上限和断线积压杀进程并明确失败，终态仍可补读', async () => {
    for (const [limits, reason] of [
      [{ outputBytes: 5, spoolBytes: 10000, eventBytes: 1024 }, 'output_limit'],
      [{ outputBytes: 10000, spoolBytes: 1, eventBytes: 1024 }, 'event_persistence_failed'],
    ] as const) {
      const { supervisor, journal } = await boot(limits);
      const input = command('printf 123456789; exec sleep 20');
      await supervisor.start(input);
      const done = await supervisor.settled(input.executionId);
      expect(done).toMatchObject({ phase: 'finished', result: { reason } });
      expect(journal.replay(input.executionId, 0).at(-1)?.frame.type).toBe('result');
    }
  });

  test('运行中存储失效会停进程；不能持久化结果时重启只报告 unknown', async () => {
    const { supervisor, journal, directory, lines } = await boot();
    const input = command('sleep 0.1; printf output; exec sleep 20');
    await supervisor.start(input);
    journal.close();
    await expect(supervisor.settled(input.executionId)).rejects.toThrow();
    expect(lines.some((line) => line.includes('result could not be persisted'))).toBe(true);
    const recovered = new ExecutionJournal(directory, 'next-incarnation', { outputBytes: 65536, spoolBytes: 262144, eventBytes: 65536 });
    try {
      expect(recovered.reserve(input)).toMatchObject({ created: false, receipt: { phase: 'unknown', result: null } });
    } finally { recovered.close(); }
  });
});

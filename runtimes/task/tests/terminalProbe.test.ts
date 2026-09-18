import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { IDENTITY_HEADERS, RunnerResultPayloads } from '@crewstation/contracts';
import type { FakeSession } from './fakeSession';
import { CommandFailure, startFakeSession } from './fakeSession';
import { launchSpec, material } from './profileFixtures';
import type { TestRunner } from './testRunner';
import { startTestRunner } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function boot(): Promise<{ session: FakeSession; tr: TestRunner }> {
  const session = startFakeSession();
  cleanups.push(() => session.stop());
  const tr = await startTestRunner(session.url);
  cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  return { session, tr };
}

const SECRET = 'sk-probe-secret-4z';
const TOKEN = 'dev-session-token-probe';
const mcp = [{ name: 'operations', url: 'http://mcp-operations.svc/mcp', headers: { [IDENTITY_HEADERS.devSessionToken]: TOKEN } }];
const hookOutput = { kind: 'script' as const, stepId: 'hook', name: '输出变量', language: 'shell' as const, argv: [], timeoutMs: 10000, source: 'printf \'{"FROM_HOOK":"from-hook"}\' > "$CS_HOOK_ENV_OUT"' };

/** 通用终端协议的档位测试命令（RFC-006 C11）；缺省：先跑一个输出变量的脚本步骤，再以 sh 执行测试命令。 */
function probe(probeId: string, overrides: Record<string, unknown> = {}): { id: string; type: string } & Record<string, unknown> {
  return {
    id: `${probeId}-${String(overrides.processAttemptId ?? 1)}`, type: 'probeTerminal', probeId, compute: 'codex-term', profileRevision: 4, launch: launchSpec('terminal'),
    command: ['sh', '-c', 'echo "tool v1.2.3"'], expect: '^tool v\\d+\\.\\d+', timeoutMs: 10000, mcp, env: {},
    beforeStart: material([hookOutput], { secrets: { API_KEY: SECRET } }), processAttemptId: `${probeId}:1`, ...overrides,
  };
}

const exists = (path: string) => stat(path).then(() => true, () => false);

describe('probeTerminal（RFC-006 C11、§6.2）', () => {
  test('先跑启动前步骤，再以同一份环境执行测试命令：CS_MCP_* 与档位凭据可用，输出按正则判定且脱敏；同一 attempt 重发不重跑', async () => {
    const { session, tr } = await boot();
    const command = probe('probe-ok', { command: ['sh', '-c', 'echo run >> runs.txt; printf "tool v1.2.3 key=%s tok=%s ops=%s hook=%s\\n" "$API_KEY" "$CS_MCP_TOKEN" "$CS_MCP_OPERATIONS_URL" "$FROM_HOOK"'] });
    const result = RunnerResultPayloads.probeTerminal.parse(await session.call(command, 15_000));
    expect(result).toMatchObject({ probeId: 'probe-ok', beforeStart: { state: 'succeeded' }, command: { exitCode: 0, timedOut: false, matched: true } });
    expect(result.command?.outputTail).toBe('tool v1.2.3 key=*** tok=*** ops=http://mcp-operations.svc/mcp hook=from-hook\n');
    expect(result.command?.spawnError).toBeUndefined();
    const again = RunnerResultPayloads.probeTerminal.parse(await session.call({ ...command, id: 'probe-ok-resend' }, 15_000));
    expect(again).toEqual(result);
    expect(await readFile(join(tr.workdir, 'runs.txt'), 'utf8')).toBe('run\n');
    const executions = session.eventsOf('beforeStart').map((e) => e.event.execution).filter((e) => e.agentId === 'probe-ok');
    expect(new Set(executions.map((e) => e.executionId)).size).toBe(1);
    expect(executions.at(-1)).toMatchObject({ state: 'succeeded', profile: { profile: 'balanced', revision: 3 } });
    expect(JSON.stringify(session.frames)).not.toContain(SECRET);
    expect(JSON.stringify(session.frames)).not.toContain(TOKEN);
    expect(tr.logLines.some((line) => line.includes(SECRET) || line.includes(TOKEN))).toBe(false);
    expect(await exists(join(tr.config.agentRunDir!, 'probe-ok'))).toBe(false);
  });

  test('输出不匹配时 matched=false 但如实给出退出码；非零退出同样如实回报', async () => {
    const { session } = await boot();
    const mismatch = RunnerResultPayloads.probeTerminal.parse(await session.call(probe('probe-miss', { expect: '^never' }), 15_000));
    expect(mismatch.command).toMatchObject({ exitCode: 0, matched: false, timedOut: false, outputTail: 'tool v1.2.3\n' });
    const failing = RunnerResultPayloads.probeTerminal.parse(await session.call(probe('probe-exit', { command: ['sh', '-c', 'echo "tool v9.9"; exit 7'] }), 15_000));
    expect(failing.command).toMatchObject({ exitCode: 7, matched: true, timedOut: false });
  });

  test('超时杀整个进程组：timedOut，退出码为空，孙进程不再存活', async () => {
    const { session, tr } = await boot();
    const marker = join(tr.workdir, 'grandchild-alive');
    const startedAt = Date.now();
    const result = RunnerResultPayloads.probeTerminal.parse(await session.call(probe('probe-slow', { timeoutMs: 1000, command: ['sh', '-c', `echo "tool v1.0"; (sleep 30; touch ${JSON.stringify(marker)}) & sleep 30`] }), 20_000));
    expect(result.command).toMatchObject({ timedOut: true, exitCode: null, matched: true });
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    await Bun.sleep(300);
    expect(await exists(marker)).toBe(false);
  }, 30_000);

  test('启动前步骤失败时不执行测试命令，只回步骤错误；私有目录已释放', async () => {
    const { session, tr } = await boot();
    const command = probe('probe-hook', { command: ['sh', '-c', 'echo run >> runs.txt'], beforeStart: material([{ ...hookOutput, stepId: 'bad', name: '坏脚本', source: 'exit 3' }]) });
    const result = RunnerResultPayloads.probeTerminal.parse(await session.call(command, 15_000));
    expect(result.beforeStart).toMatchObject({ state: 'failed', error: { code: 'script_failed', stepId: 'bad' } });
    expect(result.command).toBeUndefined();
    expect(await exists(join(tr.workdir, 'runs.txt'))).toBe(false);
    expect(await exists(join(tr.config.agentRunDir!, 'probe-hook'))).toBe(false);
  });

  test('档位二进制不在位或测试命令起不来：spawnError，不判定匹配；输出尾部有界且先脱敏再截断', async () => {
    const { session, tr } = await boot();
    const absentBinary = RunnerResultPayloads.probeTerminal.parse(await session.call(probe('probe-absent', { launch: launchSpec('terminal', { binaryPath: '/opt/absent/bin/tool' }), command: ['sh', '-c', 'echo run >> runs.txt'] }), 15_000));
    expect(absentBinary.command).toMatchObject({ exitCode: null, matched: false, timedOut: false, outputTail: '' });
    expect(absentBinary.command?.spawnError).toContain('/opt/absent/bin/tool');
    expect(await exists(join(tr.workdir, 'runs.txt'))).toBe(false);
    const absentCommand = RunnerResultPayloads.probeTerminal.parse(await session.call(probe('probe-argv0', { command: ['/definitely/missing-cli', '--version'] }), 15_000));
    expect(absentCommand.command?.spawnError).toContain('/definitely/missing-cli');
    const noisy = RunnerResultPayloads.probeTerminal.parse(await session.call(probe('probe-noisy', { expect: 'a{100}', command: ['sh', '-c', 'head -c 20000 /dev/zero | tr "\\0" a; printf "%s" "$API_KEY"'] }), 15_000));
    expect(noisy.command?.matched).toBe(true);
    expect(noisy.command?.outputTail.length).toBeLessThanOrEqual(8192);
    expect(noisy.command?.outputTail.endsWith('a***')).toBe(true);
  });

  test('非法正则在执行前拒绝（validation）；同一 probeId 的另一次 attempt 在进行中时拒绝（probe_exists）', async () => {
    const { session } = await boot();
    const invalid = await session.call(probe('probe-regex', { expect: '(' })).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(CommandFailure);
    expect((invalid as CommandFailure).code).toBe('validation');
    expect(session.eventsOf('beforeStart')).toEqual([]);
    const slow = session.call(probe('probe-busy', { command: ['sh', '-c', 'sleep 1; echo "tool v1.0"'] }), 15_000);
    await session.waitForEvent('beforeStart', (e) => e.execution.agentId === 'probe-busy' && e.execution.state === 'succeeded');
    const busy = await session.call(probe('probe-busy', { processAttemptId: 'probe-busy:2' })).catch((error: unknown) => error);
    expect((busy as CommandFailure).code).toBe('probe_exists');
    expect(RunnerResultPayloads.probeTerminal.parse(await slow).command?.matched).toBe(true);
  });
});

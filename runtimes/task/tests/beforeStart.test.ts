import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BeforeStartExecution, BeforeStartMaterial, McpConnection, RunnerEvent } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TERMINAL_MCP_ENV } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { BeforeStartRunner } from '../src/beforeStart/beforeStartRunner';
import { BeforeStartFailure } from '../src/beforeStart/failure';
import { detectInterpreters } from '../src/beforeStart/interpreters';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-before-start-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const isolation = resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) });
  const launcher = createProcessLauncher({ isolation, processEnv: process.env, workerHome: root, logger: noopLogger });
  const interpreters = await detectInterpreters(launcher, (b) => Bun.which(b), 5000);
  const events: RunnerEvent[] = [];
  const runner = new BeforeStartRunner({ launcher, interpreters, emit: (e) => events.push(e), logger: noopLogger, baseDir: join(root, 'agents') });
  const workspace = join(root, 'work');
  await Bun.write(join(workspace, '.keep'), '');
  return { root, launcher, interpreters, events, runner, workspace };
}

function material(steps: BeforeStartMaterial['steps'], extra: Partial<BeforeStartMaterial> = {}): BeforeStartMaterial {
  return { profile: 'qa-profile', revision: 3, contentHash: 'hash', steps, vars: { GATEWAY: 'https://gateway.example' }, secrets: { API_KEY: 'sk-secret-value-9x' }, configFile: { kind: 'none' }, captureOutput: true, ...extra };
}

/** 平台两个 MCP 的连接（组合根下发的名字）；令牌在会话令牌头里。 */
const MCP_TOKEN = 'dev-session-token-7q';
const platformMcp = [
  { name: 'capabilities', url: 'http://mcp-capabilities.svc/mcp', headers: { [IDENTITY_HEADERS.devSessionToken]: MCP_TOKEN } },
  { name: 'operations', url: 'http://mcp-operations.svc/mcp', headers: { [IDENTITY_HEADERS.devSessionToken]: MCP_TOKEN } },
];

const executions = (events: RunnerEvent[]): BeforeStartExecution[] => events.flatMap((e) => (e.kind === 'beforeStart' ? [e.execution] : []));

describe('启动前 Hook 执行器（RFC-004）', () => {
  test('文件 → Shell → Python → JavaScript → 文件：三种真实解释器按顺序执行，环境输出逐步传递，凭据只经环境不进日志', async () => {
    const f = await fixture();
    const languages = f.interpreters.list.map((i) => i.language);
    expect(languages).toContain('shell'); expect(languages).toContain('javascript');
    const hasPython = languages.includes('python');
    const outcome = await f.runner.run({ agentId: 'agent-one', processAttemptId: 'agent-one:1', workspace: f.workspace, material: material([
      { kind: 'file', stepId: 'settings', name: '写 settings', pathTemplate: '{{agent.home}}/.claude/settings.json', format: 'json', mode: 0o600, existing: 'require-same', contentTemplate: '{"env":{"BASE":"{{vars.GATEWAY}}","TOKEN":"{{secrets.API_KEY}}"},"quote":"a\\"b"}' },
      { kind: 'script', stepId: 'sh', name: 'Shell 输出', language: 'shell', argv: ['arg-one'], timeoutMs: 20000, source: 'set -eu\ntest "$API_KEY" = "sk-secret-value-9x"\ntest -f "$CS_AGENT_HOME/.claude/settings.json"\necho "leak: $API_KEY"\nprintf \'{"FROM_SHELL":"%s-%s"}\' "$1" "$(basename "$PWD")" > "$CS_HOOK_ENV_OUT"\n' },
      ...(hasPython ? [{ kind: 'script' as const, stepId: 'py', name: 'Python 输出', language: 'python' as const, argv: [], timeoutMs: 20000, source: 'import json, os, sys\nassert os.environ["FROM_SHELL"].startswith("arg-one-")\nassert sys.version_info.major == 3\nwith open(os.environ["CS_HOOK_ENV_OUT"], "w") as f:\n    json.dump({"FROM_PYTHON": "py-" + os.environ["FROM_SHELL"]}, f)\n' }] : []),
      { kind: 'script', stepId: 'js', name: 'JavaScript 输出', language: 'javascript', argv: [], timeoutMs: 20000, source: `const prev = process.env.${hasPython ? 'FROM_PYTHON' : 'FROM_SHELL'};\nawait Bun.write(process.env.CS_HOOK_ENV_OUT, JSON.stringify({ FROM_JS: 'js-' + prev, NOT_APPLIED_EXPORT: process.env.PATH ? 'x' : 'y' }));\nconsole.log('stdout is not the protocol');\n` },
      { kind: 'file', stepId: 'summary', name: '写汇总', pathTemplate: '{{agent.runDir}}/summary.txt', format: 'text', mode: 0o600, existing: 'replace', contentTemplate: 'js={{env.FROM_JS}} sh={{env.FROM_SHELL}}' },
    ]) });
    expect(outcome.execution.state).toBe('succeeded');
    expect(outcome.execution.profile).toEqual({ profile: 'qa-profile', revision: 3 });
    expect(outcome.execution.steps.map((s) => s.state)).toEqual(outcome.execution.steps.map(() => 'succeeded'));
    const settings = JSON.parse(await readFile(join(outcome.home, '.claude', 'settings.json'), 'utf8'));
    expect(settings).toEqual({ env: { BASE: 'https://gateway.example', TOKEN: 'sk-secret-value-9x' }, quote: 'a"b' });
    expect((await stat(join(outcome.home, '.claude', 'settings.json'))).mode & 0o777).toBe(0o600);
    expect(outcome.env.FROM_SHELL).toBe('arg-one-work');
    expect(outcome.env.FROM_JS).toBe(hasPython ? 'js-py-arg-one-work' : 'js-arg-one-work');
    expect(outcome.env.HOME).toBe(outcome.home);
    expect(outcome.env.API_KEY).toBe('sk-secret-value-9x');
    expect(await readFile(join(outcome.runDir, 'summary.txt'), 'utf8')).toBe(`js=${outcome.env.FROM_JS} sh=arg-one-work`);
    const sh = outcome.execution.steps.find((s) => s.stepId === 'sh')!;
    expect(sh.outputVariables).toEqual(['FROM_SHELL']);
    // 已知凭据值在日志尾部被替换；stdout 本身不被当成输出协议。
    expect(sh.log?.stdoutTail).toContain('leak: ***');
    expect(sh.log?.stdoutTail).not.toContain('sk-secret-value-9x');
    expect(JSON.stringify(executions(f.events))).not.toContain('sk-secret-value-9x');
    expect(executions(f.events).at(-1)?.state).toBe('succeeded');
    // 同一 attempt 重发只拿回原结果，不重跑脚本。
    const again = await f.runner.run({ agentId: 'agent-one', processAttemptId: 'agent-one:1', workspace: f.workspace, material: material([]) });
    expect(again.execution.executionId).toBe(outcome.execution.executionId);
  });

  test('脚本非零退出阻断后续步骤；超时终止整个进程组；取消跳过剩余步骤', async () => {
    const f = await fixture();
    const failing = f.runner.run({ agentId: 'fail', processAttemptId: 'fail:1', workspace: f.workspace, material: material([
      { kind: 'script', stepId: 'bad', name: '失败脚本', language: 'shell', argv: [], timeoutMs: 20000, source: 'echo boom >&2; exit 42' },
      { kind: 'file', stepId: 'never', name: '不该写', pathTemplate: '{{agent.home}}/never.txt', format: 'text', mode: 0o600, existing: 'replace', contentTemplate: 'x' },
    ]) });
    const failure = await failing.catch((e: unknown) => e) as BeforeStartFailure;
    expect(failure).toBeInstanceOf(BeforeStartFailure);
    expect(failure.code).toBe('script_failed');
    const done = executions(f.events).filter((e) => e.agentId === 'fail').at(-1)!;
    expect(done.state).toBe('failed');
    expect(done.steps.map((s) => s.state)).toEqual(['failed', 'skipped']);
    expect(done.steps[0]!.exitCode).toBe(42);
    expect(done.steps[0]!.log?.stderrTail).toContain('boom');
    expect(await Bun.file(join(f.runner.homeFor('fail'), 'never.txt')).exists()).toBe(false);

    const marker = join(f.root, 'grandchild-alive');
    const startedAt = Date.now();
    const timeout = await f.runner.run({ agentId: 'slow', processAttemptId: 'slow:1', workspace: f.workspace, material: material([
      { kind: 'script', stepId: 'sleep', name: '超时脚本', language: 'shell', argv: [], timeoutMs: 1000, source: `(sleep 30; touch ${JSON.stringify(marker)}) &\nsleep 30\n` },
    ]) }).catch((e: unknown) => e) as BeforeStartFailure;
    expect(timeout.code).toBe('script_timeout');
    expect(Date.now() - startedAt).toBeLessThan(15000);
    await Bun.sleep(300);
    expect(await Bun.file(marker).exists()).toBe(false);

    const cancelled = f.runner.run({ agentId: 'cancel', processAttemptId: 'cancel:1', workspace: f.workspace, material: material([
      { kind: 'script', stepId: 'wait', name: '等待取消', language: 'shell', argv: [], timeoutMs: 30000, source: 'sleep 30' },
      { kind: 'script', stepId: 'after', name: '之后', language: 'shell', argv: [], timeoutMs: 1000, source: 'true' },
    ]) });
    await Bun.sleep(300);
    f.runner.cancel('cancel');
    const cancelledFailure = await cancelled.catch((e: unknown) => e) as BeforeStartFailure;
    expect(cancelledFailure.code).toBe('cancelled');
    const last = executions(f.events).filter((e) => e.agentId === 'cancel').at(-1)!;
    expect(last.state).toBe('cancelled');
    expect(last.steps.map((s) => s.state)).toEqual(['cancelled', 'cancelled']);
  });

  test('模板未定义变量、非法 JSON、保留变量、非法输出与缺失解释器各有独立错误码', async () => {
    const f = await fixture();
    const run = (stepsInput: BeforeStartMaterial['steps'], id: string) => f.runner.run({ agentId: id, processAttemptId: `${id}:1`, workspace: f.workspace, material: material(stepsInput) }).then(() => 'ok', (e: BeforeStartFailure) => e.code);
    expect(await run([{ kind: 'file', stepId: 'a', name: 'a', pathTemplate: '{{agent.home}}/a.json', format: 'json', mode: 0o600, existing: 'replace', contentTemplate: '{"x":"{{vars.MISSING}}"}' }], 'undef')).toBe('template_variable_undefined');
    expect(await run([{ kind: 'file', stepId: 'b', name: 'b', pathTemplate: '{{agent.home}}/b.json', format: 'json', mode: 0o600, existing: 'replace', contentTemplate: '{"x": {{vars.GATEWAY}} }' }], 'json')).toBe('invalid_json');
    expect(await run([{ kind: 'script', stepId: 'c', name: 'c', language: 'shell', argv: [], timeoutMs: 5000, source: 'printf \'{"HOME":"/tmp"}\' > "$CS_HOOK_ENV_OUT"' }], 'reserved')).toBe('reserved_variable');
    expect(await run([{ kind: 'script', stepId: 'd', name: 'd', language: 'shell', argv: [], timeoutMs: 5000, source: 'printf \'not json\' > "$CS_HOOK_ENV_OUT"' }], 'badout')).toBe('env_output_invalid');
    expect(await run([{ kind: 'script', stepId: 'e', name: 'e', language: 'shell', argv: [], timeoutMs: 5000, source: 'printf \'{"N":1}\' > "$CS_HOOK_ENV_OUT"' }], 'nonstring')).toBe('env_output_invalid');
    expect(await run([{ kind: 'script', stepId: 'f', name: 'f', language: 'custom', interpreter: ['/definitely/missing/interpreter'], argv: [], timeoutMs: 5000, source: 'x' }], 'custom')).toBe('unknown_interpreter');
    expect(await run([{ kind: 'file', stepId: 'g', name: 'g', pathTemplate: '{{agent.home}}/../escape.txt', format: 'text', mode: 0o600, existing: 'replace', contentTemplate: 'x' }], 'escape')).toBe('path_denied');
    // export 与普通 stdout 都不是输出协议：没有输出文件就没有额外变量。
    const plain = await f.runner.run({ agentId: 'plain', processAttemptId: 'plain:1', workspace: f.workspace, material: material([{ kind: 'script', stepId: 'h', name: 'h', language: 'shell', argv: [], timeoutMs: 5000, source: 'export SHOULD_NOT_LEAK=1; echo "{\\"SHOULD_NOT_LEAK\\":\\"1\\"}"' }]) });
    expect(plain.env.SHOULD_NOT_LEAK).toBeUndefined();
    expect(plain.execution.steps[0]!.outputVariables).toEqual([]);
  });

  test('共享固定路径：相同内容共用，不同内容报 file_path_in_use，replace 策略原子覆盖且不留临时文件', async () => {
    const f = await fixture();
    const shared = join(f.root, 'shared', 'config.txt');
    const step = (content: string, existing: 'require-same' | 'replace' = 'require-same') => material([{ kind: 'file', stepId: 'shared', name: '共享', pathTemplate: shared, format: 'text', mode: 0o600, existing, contentTemplate: content }]);
    await f.runner.run({ agentId: 'one', processAttemptId: 'one:1', workspace: f.workspace, material: step('same') });
    await f.runner.run({ agentId: 'two', processAttemptId: 'two:1', workspace: f.workspace, material: step('same') });
    const conflict = await f.runner.run({ agentId: 'three', processAttemptId: 'three:1', workspace: f.workspace, material: step('different') }).catch((e: BeforeStartFailure) => e.code);
    expect(conflict).toBe('file_path_in_use');
    expect(await readFile(shared, 'utf8')).toBe('same');
    f.runner.release('one'); f.runner.release('two');
    // 前两个进程结束后同一路径可以改写；replace 策略不再要求内容相同。
    await f.runner.run({ agentId: 'four', processAttemptId: 'four:1', workspace: f.workspace, material: step('different', 'replace') });
    expect(await readFile(shared, 'utf8')).toBe('different');
    const leftovers = [...new Bun.Glob('config.txt.cs-hook-*').scanSync({ cwd: join(f.root, 'shared') })];
    expect(leftovers).toEqual([]);
    // 私有目录随 release 清理，共享文件保留。
    expect(await Bun.file(join(f.runner.runDirFor('one'), 'home')).exists()).toBe(false);
    expect(await Bun.file(shared).exists()).toBe(true);
  });

  test('写入失败不留下半个原文件（只读目录）', async () => {
    const f = await fixture();
    if (probeCurrentUid() === 0) return;
    const dir = join(f.root, 'readonly');
    await Bun.write(join(dir, 'existing.txt'), 'original');
    await chmod(dir, 0o500);
    cleanups.push(() => chmod(dir, 0o700));
    const code = await f.runner.run({ agentId: 'ro', processAttemptId: 'ro:1', workspace: f.workspace, material: material([{ kind: 'file', stepId: 'w', name: 'w', pathTemplate: join(dir, 'existing.txt'), format: 'text', mode: 0o600, existing: 'replace', contentTemplate: 'changed' }]) }).catch((e: BeforeStartFailure) => e.code);
    expect(code).toBe('path_denied');
    expect(await readFile(join(dir, 'existing.txt'), 'utf8')).toBe('original');
    await writeFile(join(f.root, 'probe'), '');
  });
});

describe('平台 MCP 与路径规则（RFC-006 C16）', () => {
  test('{{mcp.*}} 在文件内容里展开，脚本环境有 CS_MCP_*，会话令牌在日志尾部被遮盖', async () => {
    const f = await fixture();
    const outcome = await f.runner.run({ agentId: 'mcp', processAttemptId: 'mcp:1', workspace: f.workspace, mcp: platformMcp, material: material([
      { kind: 'file', stepId: 'cfg', name: '写 CLI 配置', pathTemplate: '{{agent.home}}/.tool/config.json', format: 'json', mode: 0o600, existing: 'replace', contentTemplate: '{"capabilities":"{{mcp.capabilitiesUrl}}","operations":"{{mcp.operationsUrl}}","token":"{{mcp.token}}"}' },
      { kind: 'script', stepId: 'env', name: '脚本读 MCP', language: 'shell', argv: [], timeoutMs: 10000, source: `test "$${TERMINAL_MCP_ENV.token}" = "${MCP_TOKEN}"\necho "token=$${TERMINAL_MCP_ENV.token}"\nprintf '{"OPS":"%s"}' "$${TERMINAL_MCP_ENV.operationsUrl}" > "$CS_HOOK_ENV_OUT"\n` },
    ]) });
    expect(JSON.parse(await readFile(join(outcome.home, '.tool', 'config.json'), 'utf8'))).toEqual({ capabilities: 'http://mcp-capabilities.svc/mcp', operations: 'http://mcp-operations.svc/mcp', token: MCP_TOKEN });
    expect(outcome.env.OPS).toBe('http://mcp-operations.svc/mcp');
    // CLI 进程环境不自动带 CS_MCP_*：已知协议由平台注入 MCP 配置，通用终端由驱动在拉起时加。
    expect(outcome.env[TERMINAL_MCP_ENV.token]).toBeUndefined();
    const script = outcome.execution.steps.find((step) => step.stepId === 'env')!;
    expect(script.log?.stdoutTail).toContain('token=***');
    expect(JSON.stringify(executions(f.events))).not.toContain(MCP_TOKEN);
  });

  test('没有对应 MCP 连接时 {{mcp.*}} 按未定义变量失败；MCP 变量不能出现在路径里；路径只能以 /、~/ 或目录变量开头；脚本不能输出 CS_MCP_*', async () => {
    const f = await fixture();
    const run = (steps: BeforeStartMaterial['steps'], id: string, mcp: McpConnection[] = platformMcp) => f.runner.run({ agentId: id, processAttemptId: `${id}:1`, workspace: f.workspace, mcp, material: material(steps) }).then(() => 'ok', (e: BeforeStartFailure) => `${e.code}:${e.stepId ?? ''}`);
    const file = (stepId: string, pathTemplate: string, contentTemplate = 'x') => ({ kind: 'file' as const, stepId, name: stepId, pathTemplate, format: 'text' as const, mode: 0o600, existing: 'replace' as const, contentTemplate });
    expect(await run([file('tok', '{{agent.home}}/token.txt', '{{mcp.token}}')], 'no-mcp', [])).toBe('template_variable_undefined:tok');
    expect(await run([file('tok', '{{agent.home}}/token.txt', '{{mcp.token}}')], 'no-token', [{ name: 'operations', url: 'http://mcp-operations.svc/mcp', headers: {} }])).toBe('template_variable_undefined:tok');
    expect(await run([file('p1', '{{agent.home}}/{{mcp.token}}.txt')], 'mcp-path')).toBe('path_denied:p1');
    expect(await run([file('p2', '{{vars.GATEWAY}}/x.txt')], 'var-prefix')).toBe('path_denied:p2');
    expect(await run([file('p3', '{{agent.id}}/x.txt')], 'id-prefix')).toBe('path_denied:p3');
    expect(await run([{ kind: 'script', stepId: 's1', name: 's1', language: 'shell', argv: [], timeoutMs: 5000, cwdTemplate: 'relative/dir', source: 'true' }], 'cwd-relative')).toBe('path_denied:s1');
    expect(await run([{ kind: 'script', stepId: 's2', name: 's2', language: 'shell', argv: [], timeoutMs: 5000, source: 'printf \'{"CS_MCP_TOKEN":"forged"}\' > "$CS_HOOK_ENV_OUT"' }], 'forge')).toBe('reserved_variable:s2');
    expect(await run([file('ok', '~/fine.txt', '{{mcp.operationsUrl}}'), file('ok2', `${f.root}/shared-{{agent.id}}.txt`)], 'allowed')).toBe('ok');
  });
});

import { Database } from 'bun:sqlite';
// 运行循环：用假 ProcessHost 回放 stdout，不需要安装任何真实 CLI。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, KnownAgentProtocol, LaunchSpec } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { DriverAgentProcess, DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import { createClaudeCodeDriver } from '../drivers/claudeCode/driver';
import { createOpencodeDriver } from '../drivers/opencode/driver';
import { resetOpencodeProbes } from '../drivers/opencode/probe';
import { recordOpencodeBinaryVersion, resetOpencodeBinaryVersions } from '../drivers/opencode/versionRegistry';
import type { ScriptedTurn } from './fakeProcessHost';
import { createFakeProcessHost } from './fakeProcessHost';

const roots: string[] = [];
beforeEach(() => {
  resetOpencodeBinaryVersions();
  resetOpencodeProbes();
});
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runDir(): string {
  const path = join(tmpdir(), `cs-agent-drivers-test-${Math.random().toString(16).slice(2)}`);
  roots.push(path);
  return path;
}

/** 档位修订固定的启动规格：二进制是绝对路径（RFC-006 C5）。 */
function launch(protocol: KnownAgentProtocol, overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return { protocol, binaryPath: protocol === 'claude-code' ? '/bin/claude' : '/bin/opencode', extraArgs: [], isSandbox: false, model: 'anthropic/claude-sonnet-4', ...overrides };
}

function spec(overrides: Partial<DriverAgentSpec> = {}): DriverAgentSpec {
  return {
    agentId: 'agt-1',
    compute: 'balanced',
    profileRevision: 3,
    launch: launch('claude-code'),
    permission: 'edit',
    mode: 'oneshot',
    initialPrompt: '写个 hello',
    systemPrompt: 'you are a worker',
    mcp: [],
    ...overrides,
  };
}

function openSpec(overrides: Partial<DriverAgentSpec> = {}): DriverAgentSpec {
  return spec({ launch: launch('opencode'), ...overrides });
}

function context(host: DriverLaunchContext['host']): DriverLaunchContext {
  return { cwd: '/work', env: { PATH: '/usr/bin' }, host, logger: noopLogger, runDir: runDir() };
}

async function collect(process: DriverAgentProcess): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of process.events) out.push(event);
  return out;
}

const CLAUDE_TURN = (text: string, sessionId = 'sess-1'): ScriptedTurn => ({
  stdout: [
    `{"type":"system","subtype":"init","session_id":"${sessionId}"}`,
    `{"type":"assistant","parent_tool_use_id":null,"session_id":"${sessionId}","message":{"content":[{"type":"text","text":"${text}"}]}}`,
    `{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"${sessionId}","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}`,
  ],
});

describe('oneshot 运行', () => {
  test('business execution opts into usage frames while preserving the final completion boundary', async () => {
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start({ ...spec(), businessEvents: true }, context(host)));
    expect(events.map((event) => event.type)).toEqual(['started', 'session', 'text', 'usage', 'completed']);
    expect(events.find((event) => event.type === 'usage')?.usage).toMatchObject({ mode: 'cumulative', inputTokens: 10, outputTokens: 5 });
  });
  test('started → session → text → completed，用量落在 completed 上', async () => {
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host)));
    expect(events.map((e) => e.type)).toEqual(['started', 'session', 'text', 'completed']);
    expect(events[1]?.sessionId).toBe('sess-1');
    expect(events[2]?.text).toBe('好的');
    expect(events[3]?.result?.usage).toMatchObject({ input: 10, output: 5, total: 15 });
    expect(events[3]?.result?.exitCode).toBe(0);
  });

  test('started 事件只记规格摘要，不含任何环境变量或凭据', async () => {
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host)));
    expect(events[0]?.raw).toEqual({
      protocol: 'claude-code', mode: 'oneshot', model: 'anthropic/claude-sonnet-4', permission: 'edit',
      mcp: [], systemPrompt: true, resume: false,
    });
    // spec 是契约字段（RFC-006）：档位名＋受理时固定的修订＋协议；二进制路径属于管理面，不进事件。
    expect(events[0]?.spec).toEqual({ compute: 'balanced', profileRevision: 3, protocol: 'claude-code', model: 'anthropic/claude-sonnet-4', permission: 'edit' });
    expect(JSON.stringify(events[0])).not.toContain('/bin/claude');
  });

  test('prompt 经 stdin 写一次后立即关闭', async () => {
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host)));
    expect(host.spawns[0]?.stdinWrites).toEqual(['写个 hello']);
    expect(host.spawns[0]?.stdinEnded).toBe(true);
  });

  test('非零退出 → error 事件带 stderr 尾部，流随即结束', async () => {
    const host = createFakeProcessHost([{ stdout: [], stderr: ['boom: provider auth failed'], exitCode: 1 }]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host)));
    expect(events.at(-1)?.type).toBe('error');
    expect(events.at(-1)?.error?.code).toBe('agent_failed');
    expect(events.at(-1)?.error?.message).toContain('provider auth failed');
  });

  test('干净退出但 result.is_error → agent_reported_error', async () => {
    const host = createFakeProcessHost([{
      stdout: ['{"type":"result","subtype":"error","is_error":true,"result":"Not logged in","session_id":"s"}'],
    }]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host)));
    expect(events.at(-1)?.error).toEqual({ code: 'agent_reported_error', message: 'Not logged in' });
  });

  test('resume 目标不存在时归为 session_not_found', async () => {
    const host = createFakeProcessHost([{ stdout: [], stderr: ['No conversation found with session ID: x'], exitCode: 1 }]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec({ resumeSessionId: 'x' }), context(host)));
    expect(events.at(-1)?.error?.code).toBe('session_not_found');
  });

  test('非 JSON 的 stdout 行按原样文本呈现，不丢诊断', async () => {
    const host = createFakeProcessHost([{ stdout: ['plain diagnostic line'] }]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host)));
    expect(events.find((e) => e.type === 'text')?.text).toBe('plain diagnostic line');
  });

  test('oneshot Agent 拒绝后续消息', async () => {
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    const agent = createClaudeCodeDriver(() => '/bin/claude').start(spec(), context(host));
    await collect(agent);
    await expect(agent.send('再来一次')).rejects.toMatchObject({ code: 'agent_not_interactive' });
  });
});

describe('OpenCode 交互式：链式 one-shot ＋ --session 续接', () => {
  test('版本注册表是冷的时先探一次 --version，探到的版本决定 auto flag 拼写', async () => {
    const host = createFakeProcessHost([
      { stdout: ['1.17.0'] },
      { stdout: ['{"type":"step_finish","sessionID":"ses_1"}'] },
    ]);
    await collect(createOpencodeDriver(() => '/bin/opencode').start(openSpec(), context(host)));
    expect(host.spawns[0]?.cmd).toEqual(['/bin/opencode', '--version']);
    expect(host.spawns[1]?.cmd).toContain('--dangerously-skip-permissions');
    // 只探一次：第二个 Agent 直接查表。
    const second = createFakeProcessHost([{ stdout: ['{"type":"step_finish","sessionID":"ses_2"}'] }]);
    await collect(createOpencodeDriver(() => '/bin/opencode').start(openSpec({ agentId: 'agt-2' }), context(second)));
    expect(second.spawns).toHaveLength(1);
    expect(second.spawns[0]?.cmd).toContain('--dangerously-skip-permissions');
  });

  test('第二轮用第一轮捕获到的 sessionID 续接，每轮一个进程', async () => {
    recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
    const host = createFakeProcessHost([
      { stdout: ['{"type":"text","part":{"type":"text","text":"一"},"sessionID":"ses_1"}', '{"type":"step_finish","sessionID":"ses_1"}'] },
      { stdout: ['{"type":"text","part":{"type":"text","text":"二"},"sessionID":"ses_1"}', '{"type":"step_finish","sessionID":"ses_1"}'] },
    ]);
    const agent = createOpencodeDriver(() => '/bin/opencode').start(openSpec({ mode: 'interactive' }), context(host));
    const events: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of agent.events) events.push(event);
    })();
    await waitFor(() => events.some((e) => e.type === 'status'));
    await agent.send('第二轮');
    await waitFor(() => events.filter((e) => e.type === 'status').length === 2);
    await agent.cancel();
    await pump;
    expect(host.spawns).toHaveLength(2);
    expect(host.spawns[0]?.cmd).not.toContain('--session');
    expect(host.spawns[1]?.cmd.slice(-4)).toEqual(['--session', 'ses_1', '--', '第二轮']);
    expect(events.at(-1)?.type).toBe('cancelled');
  });

  test('opencode 的 prompt 走 argv，stdin 不开管道', async () => {
    recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
    const host = createFakeProcessHost([{ stdout: ['{"type":"step_finish","sessionID":"ses_1"}'] }]);
    await collect(createOpencodeDriver(() => '/bin/opencode').start(openSpec(), context(host)));
    expect(host.spawns[0]?.stdinWrites).toEqual([]);
    expect(host.spawns[0]?.cmd.at(-1)).toBe('写个 hello');
  });
});

describe('Claude 交互式：常驻进程 ＋ stream-json 输入帧', () => {
  test('同一个进程承接两轮，第二轮不重新拉起也不带 --resume', async () => {
    const reply = (text: string): string[] => [
      `{"type":"assistant","parent_tool_use_id":null,"session_id":"sess-1","message":{"content":[{"type":"text","text":"${text}"}]}}`,
      '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"sess-1"}',
    ];
    const host = createFakeProcessHost([{
      stdout: ['{"type":"system","subtype":"init","session_id":"sess-1"}'],
      onFrame: (frame) => reply(String(JSON.parse(frame).message.content)),
    }]);
    const agent = createClaudeCodeDriver(() => '/bin/claude').start(spec({ mode: 'interactive' }), context(host));
    const events: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of agent.events) events.push(event);
    })();
    await waitFor(() => events.filter((e) => e.type === 'status').length === 1);
    await agent.send('第二轮');
    await waitFor(() => events.filter((e) => e.type === 'status').length === 2);
    expect(host.spawns).toHaveLength(1);
    expect(host.spawns[0]?.cmd).toContain('--input-format');
    expect(host.spawns[0]?.cmd).not.toContain('--resume');
    expect(host.spawns[0]?.stdinWrites).toHaveLength(2);
    expect(JSON.parse(host.spawns[0]?.stdinWrites[1] ?? '{}')).toMatchObject({ type: 'user', message: { role: 'user', content: '第二轮' } });
    expect(events.filter((e) => e.type === 'text').map((e) => e.text)).toEqual(['写个 hello', '第二轮']);
    await agent.cancel();
    await pump;
    expect(events.at(-1)?.type).toBe('cancelled');
  });
});

describe('档位的二进制与参数（RFC-006）', () => {
  test('二进制取自 launch.binaryPath：不在位时报 driver_not_installed 并点名该路径，不回落 claude', async () => {
    const host = createFakeProcessHost([]);
    const events = await collect(createClaudeCodeDriver((binary) => (binary === '/opt/fork/bin/claude' ? null : binary)).start(spec({ launch: launch('claude-code', { binaryPath: '/opt/fork/bin/claude' }) }), context(host)));
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect(events[0]?.error).toEqual({ code: 'driver_not_installed', message: 'driver binary not installed: /opt/fork/bin/claude' });
    expect(host.spawns).toHaveLength(0);
  });

  test('协议与驱动不符（平台下发错了）只报 protocol_mismatch，不拉起进程', async () => {
    const host = createFakeProcessHost([]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/opencode').start(spec({ launch: launch('opencode') }), context(host)));
    expect(events.map((e) => e.error?.code)).toEqual(['protocol_mismatch']);
    expect(host.spawns).toHaveLength(0);
  });

  test('命令头就是档位的二进制；附加参数排在全部平台 argv 之后', async () => {
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    await collect(createClaudeCodeDriver((b) => b).start(spec({ launch: launch('claude-code', { binaryPath: '/opt/fork/bin/claude', extraArgs: ['--skip-safe-check', '--region', 'cn'] }) }), context(host)));
    const cmd = host.spawns[0]?.cmd ?? [];
    expect(cmd[0]).toBe('/opt/fork/bin/claude');
    expect(cmd.slice(-3)).toEqual(['--skip-safe-check', '--region', 'cn']);
  });

  test('附加参数不能覆盖平台参数（含 --flag=value）：装配失败，一个进程都不起', async () => {
    for (const extraArgs of [['--model', 'x'], ['--settings=/tmp/x.json'], ['bare-positional']]) {
      const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
      const events = await collect(createClaudeCodeDriver((b) => b).start(spec({ launch: launch('claude-code', { extraArgs }) }), context(host)));
      expect(events.map((e) => e.error?.code)).toEqual(['driver_setup_failed']);
      expect(host.spawns).toHaveLength(0);
    }
  });

  test('opencode 不接受附加参数；配置目录变量名不能与平台注入的变量同名', async () => {
    const host = createFakeProcessHost([]);
    const withArgs = await collect(createOpencodeDriver((b) => b).start(openSpec({ launch: launch('opencode', { extraArgs: ['--x'] }) }), context(host)));
    expect(withArgs.map((e) => e.error?.code)).toEqual(['driver_setup_failed']);
    const reserved = await collect(createOpencodeDriver((b) => b).start(openSpec({ launch: launch('opencode', { configDirEnv: 'OPENCODE_CONFIG_CONTENT' }) }), context(host)));
    expect(reserved.map((e) => e.error?.code)).toEqual(['driver_setup_failed']);
    expect(reserved[0]?.error?.message).toContain('OPENCODE_CONFIG_CONTENT');
    expect(host.spawns).toHaveLength(0);
  });

  test('没有模型时（P2）started 不带 model，argv 也不带 --model', async () => {
    const { model: _omit, ...rest } = launch('claude-code');
    const host = createFakeProcessHost([CLAUDE_TURN('好的')]);
    const events = await collect(createClaudeCodeDriver((b) => b).start(spec({ launch: rest as LaunchSpec }), context(host)));
    expect(events[0]?.spec).toEqual({ compute: 'balanced', profileRevision: 3, protocol: 'claude-code', permission: 'edit' });
    expect(host.spawns[0]?.cmd).not.toContain('--model');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await Bun.sleep(2);
  }
}


test('RFC-034 opt-in root captures travel with legacy usage events while unselected drivers stay unchanged', async () => {
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
  const frame = JSON.stringify({ type: 'step_finish', sessionID: 'native-usage', part: { id: 'step-usage', tokens: { input: 9, output: 2, cache: { read: 3, write: 0 } } } });
  for (const enabled of [false, true]) {
    const host = createFakeProcessHost([{ stdout: [frame] }]);
    const events = await collect(createOpencodeDriver(() => '/bin/opencode').start(openSpec({ businessEvents: true, ...(enabled ? { usageObservationsV1: 1 as const } : {}) }), context(host)));
    const usage = events.find((event) => event.type === 'usage')!;
    expect(usage.usage?.inputTokens).toBe(9);
    if (enabled) expect(usage.usageCapture?.measurements[0]).toMatchObject({ actualModel: null, usage: { input: '9', output: '2', cacheRead: '3', cacheWrite: '0' } });
    else expect(usage.usageCapture).toBeUndefined();
  }
});

test('RFC-034 resident Claude retains tree identity and advances coverage without including the configured model', async () => {
  let turns = 0;
  const host = createFakeProcessHost([{ stdout: [], onFrame: () => {
    turns++; return [JSON.stringify({ type: 'result', uuid: `result-${turns}`, session_id: 'resident-native', usage: { input_tokens: turns }, modelUsage: { 'actual-model': { inputTokens: turns, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })];
  } }]);
  const agent = createClaudeCodeDriver(() => '/bin/claude').start(spec({ mode: 'interactive', businessEvents: true, usageObservationsV1: 1, resumeSessionId: 'resident-native' }), context(host));
  const events: AgentEvent[] = [];
  const done = (async () => { for await (const event of agent.events) events.push(event); })();
  await waitFor(() => events.some((event) => event.type === 'status'));
  await agent.send('another turn');
  await waitFor(() => events.filter((event) => event.type === 'status').length === 2);
  await agent.cancel(); await done;
  const evidence = events.flatMap((event) => event.usageCapture?.measurements ?? []);
  expect(evidence).toHaveLength(2); expect(evidence[0]?.recordId).toBe(evidence[1]?.recordId);
  expect(evidence.map((item) => item.coveredThroughTurn)).toEqual([0, 1]);
  expect(evidence[1]).toMatchObject({ actualModel: { model: 'actual-model', provider: null }, basis: { kind: 'native-session', baseline: null } });
});


test('RFC-034 native model retry precedes success or failure and never repeats legacy usage', async () => {
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
  const frame = JSON.stringify({ type: 'step_finish', sessionID: 'native-usage', part: { id: 'step-usage', messageID: 'message-usage', sessionID: 'native-usage', tokens: { input: 9, output: 2, cache: { read: 3, write: 0 } } } });
  for (const exitCode of [0, 1, 143]) {
    const host = createFakeProcessHost([{ stdout: [frame], exitCode, ...(exitCode === 143 ? { onFrame: () => [] } : {}) }]), ctx = context(host), file = join(ctx.runDir!, 'opencode.db');
    ctx.env.OPENCODE_DB = file;
    const pump = host.pumpLines;
    host.pumpLines = (stream, onLine) => pump(stream, (line) => {
      onLine(line);
      const db = new Database(file);
      db.exec('CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT)');
      db.query('INSERT INTO message VALUES(?,?,?)').run('message-usage', 'native-usage', JSON.stringify({ role: 'assistant', providerID: 'actual-provider', modelID: 'actual-model' }));
      db.query('INSERT INTO part VALUES(?,?,?,?)').run('step-usage', 'message-usage', 'native-usage', JSON.stringify({ type: 'step-finish' })); db.close();
    });
    const agent = createOpencodeDriver(() => '/bin/opencode').start(openSpec({ businessEvents: true, usageObservationsV1: 1 }), ctx);
    const collecting = collect(agent);
    if (exitCode === 143) { await waitFor(() => host.spawns.length === 1); await agent.cancel(); }
    const events = await collecting;
    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(2); expect(usage.filter((e) => e.usage)).toHaveLength(1);
    expect(usage[0]!.usageCapture!.measurements[0]!.actualModel).toBeNull();
    expect(usage[1]!.usageCapture!.measurements[0]!.actualModel).toMatchObject({ provider: 'actual-provider', model: 'actual-model' });
    expect(usage[1]!.usageCapture!.measurements[0]!.recordId).toBe(usage[0]!.usageCapture!.measurements[0]!.recordId);
    expect(events.at(-1)?.type).toBe(exitCode === 0 ? 'completed' : exitCode === 143 ? 'cancelled' : 'error');
    expect(events.at(-1)?.result?.usage).toMatchObject({ input: 9, output: 2, total: 14 });
  }
});


test('RFC-034 output-pump failure still emits the model revision before surfacing the original error', async () => {
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
  const frame = JSON.stringify({ type: 'step_finish', sessionID: 'native', part: { id: 'step', messageID: 'message', sessionID: 'native', tokens: { input: 9, output: 2, cache: { read: 3, write: 0 } } } });
  const host = createFakeProcessHost([{ stdout: [frame] }]), ctx = context(host), file = join(ctx.runDir!, 'native.db'); ctx.env.OPENCODE_DB = file;
  const original = host.pumpLines, failure = new Error('stdout read interrupted');
  host.pumpLines = (stream, onLine) => original(stream, (line) => {
    onLine(line);
    const db = new Database(file);
    db.exec('CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT)');
    db.query('INSERT INTO message VALUES(?,?,?)').run('message', 'native', JSON.stringify({ role: 'assistant', providerID: 'actual', modelID: 'model' }));
    db.query('INSERT INTO part VALUES(?,?,?,?)').run('step', 'message', 'native', JSON.stringify({ type: 'step-finish' })); db.close();
    throw failure;
  });
  const events: AgentEvent[] = [], agent = createOpencodeDriver(() => '/bin/opencode').start(openSpec({ businessEvents: true, usageObservationsV1: 1 }), ctx);
  let caught: unknown;
  try { for await (const event of agent.events) events.push(event); } catch (error) { caught = error; }
  expect(caught).toBe(failure);
  const usage = events.filter((event) => event.type === 'usage'); expect(usage).toHaveLength(2);
  expect(usage.filter((event) => event.usage)).toHaveLength(1);
  expect(usage[1]!.usageCapture!.measurements[0]!.actualModel).toMatchObject({ provider: 'actual', model: 'model' });
});

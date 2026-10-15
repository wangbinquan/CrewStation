// RFC-034 v2 §4/§8 运行循环里的用量事件：中间快照 ≤3 秒一次、每轮末先做原生汇总、终态事件之前给出最终快照
// 且终态事件本身也带上；业务 usage 事件一次执行一个累计范围。用假 ProcessHost 回放 stdout，不需要真实 CLI。

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, LaunchSpec } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { DriverAgentProcess, DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import { createClaudeCodeDriver } from '../drivers/claudeCode/driver';
import { createOpencodeDriver } from '../drivers/opencode/driver';
import { resetOpencodeProbes } from '../drivers/opencode/probe';
import { recordOpencodeBinaryVersion, resetOpencodeBinaryVersions } from '../drivers/opencode/versionRegistry';
import { createFakeProcessHost } from './fakeProcessHost';

const dirs: string[] = [];
beforeEach(() => {
  resetOpencodeBinaryVersions();
  resetOpencodeProbes();
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cs-agent-usage-'));
  dirs.push(dir);
  return dir;
}

function spec(launch: LaunchSpec, overrides: Partial<DriverAgentSpec> = {}): DriverAgentSpec {
  return { agentId: 'agt-usage', compute: 'balanced', profileRevision: 1, launch, permission: 'full', mode: 'oneshot', initialPrompt: '统计一下', mcp: [], ...overrides };
}
const opencode = (model = 'zhipu/glm-5'): LaunchSpec => ({ protocol: 'opencode', binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false, model });
const claude: LaunchSpec = { protocol: 'claude-code', binaryPath: '/bin/claude', extraArgs: [], isSandbox: false, model: 'claude-sonnet-4' };

function context(host: DriverLaunchContext['host'], env: Record<string, string> = {}): DriverLaunchContext {
  return { cwd: '/work', env: { PATH: '/usr/bin', ...env }, host, logger: noopLogger, runDir: join(tempDir(), 'run') };
}

async function collect(process: DriverAgentProcess): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of process.events) out.push(event);
  return out;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await Bun.sleep(2);
  }
}

/** 原生存储夹具：根会话两步、子 Agent 会话一步（不同的实际模型），步骤时间为 `at`。 */
function nativeStore(at: number): string {
  const path = join(tempDir(), 'opencode.db');
  const db = new Database(path);
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  const add = (id: string, session: string, parent: string | null, input: number, model: [string, string]) => {
    db.query('INSERT OR IGNORE INTO session VALUES (?,?,?,?)').run(session, parent, at, at);
    db.query('INSERT INTO message VALUES (?,?,?,?)').run(`m-${id}`, session, at, JSON.stringify({ role: 'assistant', providerID: model[0], modelID: model[1] }));
    db.query('INSERT INTO part VALUES (?,?,?,?,?)').run(id, `m-${id}`, session, at, JSON.stringify({ type: 'step-finish', tokens: { input, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }));
  };
  add('p1', 'root', null, 10, ['zhipu', 'glm-5']);
  add('p2', 'root', null, 20, ['zhipu', 'glm-5']);
  add('c1', 'child', 'root', 300, ['deepseek', 'v4-flash']);
  db.close();
  return path;
}

const step = (id: string, input: number) => JSON.stringify({ type: 'step_finish', sessionID: 'root', part: { id, type: 'step-finish', tokens: { input, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } });
const task = JSON.stringify({ type: 'tool_use', sessionID: 'root', part: { id: 't1', tool: 'task', state: { status: 'completed' } } });

test('OpenCode：首个快照即时上报、其后节流；原生存储里没有本次执行的步骤时保留流上的 partial 下界', async () => {
  // 步骤早于执行开始（恢复会话的历史）：时间下界把它们排除，汇总的根步骤少于流上已见的。
  const path = nativeStore(Date.now() - 60_000);
  const host = createFakeProcessHost([{ stdout: [step('p1', 10), task, step('p2', 20)] }]);
  const events = await collect(createOpencodeDriver(() => '/bin/opencode').start(spec(opencode()), context(host, { OPENCODE_DB: path })));
  expect(events.map((event) => event.type)).toEqual(['started', 'status', 'session', 'usage', 'tool-start', 'usage', 'completed']);
  expect(events[3]?.usageSnapshot).toEqual({ state: 'complete', models: [{ model: 'zhipu/glm-5', input: 10, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 }] });
  const partial = { state: 'partial' as const, models: [{ model: 'zhipu/glm-5', input: 30, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 }] };
  expect(events[5]?.usageSnapshot).toEqual(partial);
  expect(events[6]?.usageSnapshot).toEqual(partial);
  expect(events[6]?.result?.usage).toMatchObject({ input: 30, output: 2, total: 32 });
});

test('OpenCode：轮末汇总读到本次执行的会话树，最终快照换成含子 Agent 的实际模型拆分且为 complete', async () => {
  const path = nativeStore(Date.now() + 60_000);
  const host = createFakeProcessHost([{ stdout: [step('p1', 10), task, step('p2', 20)] }]);
  const events = await collect(createOpencodeDriver(() => '/bin/opencode').start(spec(opencode()), context(host, { OPENCODE_DB: path })));
  const complete = { state: 'complete' as const, models: [
    { model: 'deepseek/v4-flash', input: 300, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 },
    { model: 'zhipu/glm-5', input: 30, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 },
  ] };
  expect(events.at(-2)).toMatchObject({ type: 'usage', usageSnapshot: complete });
  expect(events.at(-1)).toMatchObject({ type: 'completed', usageSnapshot: complete });
});

const claudeResult = (input: number, output: number) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 'sess-r',
  modelUsage: { 'claude-sonnet-4': { inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });

test('Claude 常驻两轮：每轮末立即上报，第二轮快照替换（进程累计）而不是相加', async () => {
  let turn = 0;
  const host = createFakeProcessHost([{
    stdout: ['{"type":"system","subtype":"init","session_id":"sess-r"}'],
    onFrame: () => (++turn === 1 ? [claudeResult(10, 5)] : [claudeResult(25, 12)]),
  }]);
  const agent = createClaudeCodeDriver(() => '/bin/claude').start(spec(claude, { mode: 'interactive' }), context(host));
  const events: AgentEvent[] = [];
  const pump = (async () => { for await (const event of agent.events) events.push(event); })();
  await waitFor(() => events.filter((e) => e.type === 'usage').length === 1);
  await agent.send('第二轮');
  await waitFor(() => events.filter((e) => e.type === 'usage').length === 2);
  host.finishResident(0);
  await pump;
  const usage = events.filter((e) => e.type === 'usage').map((e) => e.usageSnapshot?.models[0]);
  expect(usage.map((row) => [row?.input, row?.output])).toEqual([[10, 5], [25, 12]]);
  expect(events.at(-1)?.type).toBe('completed');
  expect(events.at(-1)?.usageSnapshot?.models[0]).toMatchObject({ input: 25, output: 12 });
});

test('取消：已知用量先作为 usage 发出，cancelled 带同一份 partial 快照', async () => {
  const host = createFakeProcessHost([{
    stdout: ['{"type":"system","subtype":"init","session_id":"sess-c"}'],
    onFrame: () => [JSON.stringify({ type: 'assistant', parent_tool_use_id: null, session_id: 'sess-c', message: { id: 'msg-1', model: 'claude-sonnet-4', content: [], usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 500 } } })],
  }]);
  const agent = createClaudeCodeDriver(() => '/bin/claude').start(spec(claude, { mode: 'interactive' }), context(host));
  const events: AgentEvent[] = [];
  const pump = (async () => { for await (const event of agent.events) events.push(event); })();
  await waitFor(() => events.some((e) => e.type === 'usage'));
  await agent.cancel();
  await pump;
  const snapshot = { state: 'partial' as const, models: [{ model: 'claude-sonnet-4', input: 40, cacheRead: 500, cacheWrite: 0, output: 1, reasoning: 0 }] };
  expect(events.filter((e) => e.type === 'usage').map((e) => e.usageSnapshot)).toEqual([snapshot]);
  expect(events.at(-1)).toMatchObject({ type: 'cancelled', usageSnapshot: snapshot });
});

test('业务 usage 事件：同一 Agent 的两次执行用不同的累计范围，修订号递增', async () => {
  const scopes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const host = createFakeProcessHost([{ stdout: [claudeResult(10 + i, 1)] }]);
    const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start({ ...spec(claude), businessEvents: true }, context(host)));
    const usage = events.find((e) => e.type === 'usage')?.usage;
    expect(usage).toMatchObject({ mode: 'cumulative', inputTokens: 10 + i, complete: true });
    expect(usage?.measurementId).toBe(`${usage?.scope}:1`);
    scopes.push(usage!.scope);
  }
  expect(new Set(scopes).size).toBe(2);
});

test('没有任何用量报告时不发 usage，终态也不编造 0', async () => {
  const silent = createFakeProcessHost([{ stdout: ['{"type":"text","sessionID":"s","part":{"type":"text","text":"hi"}}'] }]);
  const quiet = await collect(createOpencodeDriver(() => '/bin/opencode').start(spec(opencode()), context(silent)));
  expect(quiet.some((e) => e.type === 'usage')).toBe(false);
  expect(quiet.at(-1)?.type).toBe('completed');
  expect(quiet.at(-1)?.usageSnapshot).toBeUndefined();
  expect(quiet.at(-1)?.result?.usage).toBeUndefined();
});

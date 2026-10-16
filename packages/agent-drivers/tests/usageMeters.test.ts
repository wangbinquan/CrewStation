// RFC-034 v2 §8 驱动层用例：与 agent-workflow RFC-371 v2 同一计量规则（OpenCode 流 + 原生会话树汇总、
// Claude assistant/result），加上 CrewStation 才有的多轮执行（链式续接、常驻输入流）与「＋ CLI」终端来源。
// 锁定的回归：未知不是 0、推理是输出子集、分片去重、子 Agent 只在原生存储里、恢复会话不计入历史。

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeNativeTelemetry } from '../drivers/claudeCode/nativeTelemetry';
import { createClaudeUsageMeter } from '../drivers/usage/claudeMeter';
import { businessUsageOf } from '../drivers/usage/meter';
import { createOpencodeUsageMeter } from '../drivers/usage/opencodeMeter';
import { OPENCODE_TREE_MAX_SESSIONS, opencodeUsageDatabasePath, readOpencodeStoreUsage, readOpencodeTreeUsage } from '../drivers/usage/opencodeStore';
import { createTerminalUsageMeter } from '../drivers/usage/terminalMeter';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface StepTokens { input: number; output: number; reasoning?: number; read?: number; write?: number }

/** 与 OpenCode 1.18 原生存储同形的最小夹具：session(parent_id) / message / part 三表。 */
function nativeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-native-usage-'));
  dirs.push(dir);
  const path = join(dir, 'opencode.db');
  const db = new Database(path);
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  let serial = 0;
  const step = (session: string, parent: string | null, at: number, tokens: StepTokens, model: [string, string] = ['zhipu', 'glm-5']): string => {
    db.query('INSERT OR IGNORE INTO session VALUES (?,?,?,?)').run(session, parent, at, at);
    db.query('UPDATE session SET time_updated = max(time_updated, ?) WHERE id = ?').run(at, session);
    const id = `${session}-${++serial}`;
    db.query('INSERT INTO message VALUES (?,?,?,?)').run(`msg-${id}`, session, at, JSON.stringify({ role: 'assistant', providerID: model[0], modelID: model[1] }));
    db.query('INSERT INTO part VALUES (?,?,?,?,?)').run(`prt-${id}`, `msg-${id}`, session, at, JSON.stringify({
      type: 'step-finish', tokens: { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning ?? 0, cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 } },
    }));
    return `prt-${id}`;
  };
  return { dir, path, db, step, env: { OPENCODE_DB: path } };
}

const stepFinish = (session: string, id: string | undefined, tokens: StepTokens) => ({
  type: 'step_finish', sessionID: session,
  part: { ...(id === undefined ? {} : { id }), type: 'step-finish', tokens: { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning ?? 0, cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 } } },
});
const taskTool = (session: string) => ({ type: 'tool_use', sessionID: session, part: { tool: 'task', state: { status: 'completed' } } });

describe('OpenCode 计量器', () => {
  test('流上按 part id 去重，推理加回输出一次，记在档位配置的模型下且为 complete', () => {
    const meter = createOpencodeUsageMeter({ resumed: false, configuredModel: 'zhipu/glm-5', startedAt: Date.now(), env: {} });
    expect(meter.observe(stepFinish('ses', 'p1', { input: 100, output: 20, reasoning: 5, read: 30, write: 7 }))).toBe(true);
    expect(meter.observe(stepFinish('ses', 'p1', { input: 100, output: 20, reasoning: 5, read: 30, write: 7 }))).toBe(false);
    expect(meter.observe({ type: 'text', sessionID: 'ses', part: { type: 'text', text: 'hi' } })).toBe(false);
    expect(meter.snapshot()).toEqual({ state: 'complete', models: [{ model: 'zhipu/glm-5', input: 100, cacheRead: 30, cacheWrite: 7, output: 25, reasoning: 5 }] });
  });

  test('见到 task 子 Agent 即为 partial；轮末原生汇总换成含子会话的实际模型并回到 complete', () => {
    const fixture = nativeStore();
    const startedAt = Date.now() - 1000;
    const rootStep = fixture.step('root', null, startedAt + 10, { input: 9, output: 2, read: 3 });
    fixture.step('child', 'root', startedAt + 20, { input: 40, output: 8, reasoning: 1 }, ['deepseek', 'v4-flash']);
    fixture.step('grandchild', 'child', startedAt + 30, { input: 5, output: 1 }, ['deepseek', 'v4-flash']);
    fixture.db.close();
    const meter = createOpencodeUsageMeter({ resumed: false, configuredModel: 'zhipu/glm-5', startedAt, env: fixture.env });
    meter.observe(stepFinish('root', rootStep, { input: 9, output: 2, read: 3 }));
    expect(meter.observe(taskTool('root'))).toBe(true);
    expect(meter.observe(taskTool('root'))).toBe(false);
    expect(meter.snapshot().state).toBe('partial');
    expect(meter.refresh?.()).toBe(true);
    expect(meter.snapshot()).toEqual({ state: 'complete', models: [
      { model: 'deepseek/v4-flash', input: 45, cacheRead: 0, cacheWrite: 0, output: 10, reasoning: 1 },
      { model: 'zhipu/glm-5', input: 9, cacheRead: 3, cacheWrite: 0, output: 2, reasoning: 0 },
    ] });
    // 汇总之后的下一轮步骤先按流累加在汇总之上。
    meter.observe(stepFinish('root', 'next-turn', { input: 1, output: 1 }));
    expect(meter.snapshot().models.find((row) => row.model === 'zhipu/glm-5')).toMatchObject({ input: 10, output: 3 });
  });

  test('原生存储的根步骤少于流上已见的（不是本次的存储或未落盘）时保留流上的视图', () => {
    const fixture = nativeStore();
    const startedAt = Date.now() - 1000;
    fixture.step('root', null, startedAt + 10, { input: 9, output: 2 });
    fixture.db.close();
    const meter = createOpencodeUsageMeter({ resumed: false, configuredModel: null, startedAt, env: fixture.env });
    meter.observe(stepFinish('root', 'a', { input: 9, output: 2 }));
    meter.observe(stepFinish('root', 'b', { input: 4, output: 1 }));
    meter.observe(taskTool('root'));
    expect(meter.refresh?.()).toBe(false);
    expect(meter.snapshot()).toEqual({ state: 'partial', models: [{ model: '', input: 13, cacheRead: 0, cacheWrite: 0, output: 3, reasoning: 0 }] });
  });

  test('恢复的会话只统计本次执行开始之后的步骤；存储不可用时汇总失败', () => {
    const fixture = nativeStore();
    const startedAt = Date.now();
    fixture.step('root', null, startedAt - 60_000, { input: 900, output: 90 });
    const current = fixture.step('root', null, startedAt + 5, { input: 11, output: 3 });
    fixture.db.close();
    const meter = createOpencodeUsageMeter({ resumed: true, configuredModel: 'zhipu/glm-5', startedAt, env: fixture.env });
    meter.observe(stepFinish('root', current, { input: 11, output: 3 }));
    expect(meter.refresh?.()).toBe(true);
    expect(meter.snapshot().models).toEqual([{ model: 'zhipu/glm-5', input: 11, cacheRead: 0, cacheWrite: 0, output: 3, reasoning: 0 }]);
    const missing = createOpencodeUsageMeter({ resumed: false, configuredModel: null, startedAt, env: { OPENCODE_DB: join(fixture.dir, 'absent.db') } });
    missing.observe(stepFinish('root', 'x', { input: 1, output: 1 }));
    expect(missing.refresh?.()).toBe(false);
    expect(missing.snapshot().models[0]).toMatchObject({ input: 1, output: 1 });
  });
});

const assistant = (id: string, usage: Record<string, number>, model = 'claude-sonnet-4') => ({ type: 'assistant', message: { id, model, usage } });
const result = (modelUsage: Record<string, Record<string, number>>, subtype = 'success') => ({ type: 'result', subtype, modelUsage });
const claudeModel = (inputTokens: number, outputTokens: number, cacheReadInputTokens = 0, cacheCreationInputTokens = 0) => ({ inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens });

describe('Claude 计量器', () => {
  test('同一消息的分片按各桶最大值去重为下界；result.modelUsage 替换为含子 Agent 的 complete', () => {
    const meter = createClaudeUsageMeter({ resumed: false });
    expect(meter.observe(assistant('msg-1', { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 100 }))).toBe(true);
    expect(meter.observe(assistant('msg-1', { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 100 }))).toBe(false);
    expect(meter.observe(assistant('msg-1', { input_tokens: 10, output_tokens: 6, cache_read_input_tokens: 100 }))).toBe(true);
    expect(meter.observe(assistant('msg-2', { input_tokens: 0, output_tokens: 0 }, '<synthetic>'))).toBe(false);
    expect(meter.snapshot()).toEqual({ state: 'partial', models: [{ model: 'claude-sonnet-4', input: 10, cacheRead: 100, cacheWrite: 0, output: 6, reasoning: 0 }] });
    expect(meter.observe(result({ 'claude-sonnet-4': claudeModel(12, 40, 100), 'claude-haiku-4': claudeModel(3, 2) }))).toBe(true);
    expect(meter.snapshot()).toEqual({ state: 'complete', models: [
      { model: 'claude-haiku-4', input: 3, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 },
      { model: 'claude-sonnet-4', input: 12, cacheRead: 100, cacheWrite: 0, output: 40, reasoning: 0 },
    ] });
  });

  test('崩溃时全零的 error_during_execution 不抹掉已知用量', () => {
    const meter = createClaudeUsageMeter({ resumed: false });
    meter.observe(assistant('msg-1', { input_tokens: 10, output_tokens: 1 }));
    expect(meter.observe(result({ 'claude-sonnet-4': claudeModel(0, 0) }, 'error_during_execution'))).toBe(false);
    expect(meter.snapshot()).toEqual({ state: 'partial', models: [{ model: 'claude-sonnet-4', input: 10, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 }] });
  });

  test('常驻输入流每轮的 result 是进程累计：读最新一条而不是相加，两轮之间的消息为 partial', () => {
    const meter = createClaudeUsageMeter({ resumed: false });
    meter.observe(result({ 'claude-sonnet-4': claudeModel(10, 5) }));
    meter.observe(assistant('msg-2', { input_tokens: 8, output_tokens: 1 }));
    expect(meter.snapshot()).toEqual({ state: 'partial', models: [{ model: 'claude-sonnet-4', input: 18, cacheRead: 0, cacheWrite: 0, output: 6, reasoning: 0 }] });
    meter.observe(result({ 'claude-sonnet-4': claudeModel(25, 12) }));
    expect(meter.snapshot()).toEqual({ state: 'complete', models: [{ model: 'claude-sonnet-4', input: 25, cacheRead: 0, cacheWrite: 0, output: 12, reasoning: 0 }] });
  });

  test('恢复会话：首个 result 含恢复的历史只作基线，首轮按 assistant 合计，之后各轮用差值，始终 partial', () => {
    const meter = createClaudeUsageMeter({ resumed: true });
    meter.observe(assistant('msg-1', { input_tokens: 7, output_tokens: 1 }));
    meter.observe(result({ 'claude-sonnet-4': claudeModel(1000, 300) }));
    expect(meter.snapshot()).toEqual({ state: 'partial', models: [{ model: 'claude-sonnet-4', input: 7, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 }] });
    meter.observe(assistant('msg-2', { input_tokens: 20, output_tokens: 1 }));
    meter.observe(result({ 'claude-sonnet-4': claudeModel(1030, 320), 'claude-haiku-4': claudeModel(4, 2) }));
    expect(meter.snapshot()).toEqual({ state: 'partial', models: [
      { model: 'claude-haiku-4', input: 4, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 },
      { model: 'claude-sonnet-4', input: 37, cacheRead: 0, cacheWrite: 0, output: 21, reasoning: 0 },
    ] });
  });

  test('/clear 等重置之后累计从零开始，重置前最后一个 result 保留', () => {
    const meter = createClaudeUsageMeter({ resumed: false });
    meter.observe(result({ 'claude-sonnet-4': claudeModel(10, 5) }));
    expect(meter.observe({ type: 'conversation_reset', session_id: 'new' })).toBe(false);
    meter.observe(result({ 'claude-sonnet-4': claudeModel(4, 1) }));
    expect(meter.snapshot()).toEqual({ state: 'complete', models: [{ model: 'claude-sonnet-4', input: 14, cacheRead: 0, cacheWrite: 0, output: 6, reasoning: 0 }] });
  });
});

describe('OpenCode 原生存储读取', () => {
  test('与 OpenCode 一致地定位存储：绝对 OPENCODE_DB、数据目录相对名、XDG、HOME；:memory: 与无从定位为 null', () => {
    expect(opencodeUsageDatabasePath({ OPENCODE_DB: '/data/x.db' })).toBe('/data/x.db');
    expect(opencodeUsageDatabasePath({ OPENCODE_DB: ':memory:' })).toBeNull();
    expect(opencodeUsageDatabasePath({ OPENCODE_DB: 'custom.db', XDG_DATA_HOME: '/xdg' })).toBe('/xdg/opencode/custom.db');
    expect(opencodeUsageDatabasePath({ XDG_DATA_HOME: '/xdg', HOME: '/home/w' })).toBe('/xdg/opencode/opencode.db');
    expect(opencodeUsageDatabasePath({ HOME: '/home/w' })).toBe('/home/w/.local/share/opencode/opencode.db');
    expect(opencodeUsageDatabasePath({ XDG_DATA_HOME: 'relative' })).toBeNull();
    expect(opencodeUsageDatabasePath({})).toBeNull();
  });

  test('会话树汇总只含根及其子孙、按实际模型分组；规模超界不汇总', () => {
    const fixture = nativeStore();
    const since = Date.now() - 1000;
    fixture.step('root', null, since + 1, { input: 1, output: 1 });
    fixture.step('child', 'root', since + 2, { input: 2, output: 2 }, ['openai', 'gpt-5']);
    fixture.step('other', null, since + 3, { input: 50, output: 50 });
    expect(readOpencodeTreeUsage(fixture.path, ['root'], since)).toEqual({ rootSteps: 1, models: [
      { model: 'openai/gpt-5', input: 2, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 },
      { model: 'zhipu/glm-5', input: 1, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 },
    ] });
    for (let i = 0; i <= OPENCODE_TREE_MAX_SESSIONS; i++) fixture.db.query('INSERT INTO session VALUES (?,?,?,?)').run(`bulk-${i}`, 'root', since, since);
    expect(readOpencodeTreeUsage(fixture.path, ['root'], since)).toBeNull();
    fixture.db.close();
  });

  test('终端整库读取只看执行开始以来活跃的会话与步骤', () => {
    const fixture = nativeStore();
    const since = Date.now();
    fixture.step('old', null, since - 5000, { input: 100, output: 100 });
    fixture.step('active', null, since + 1, { input: 3, output: 4, reasoning: 2 });
    fixture.db.close();
    expect(readOpencodeStoreUsage(fixture.path, since)).toEqual([{ model: 'zhipu/glm-5', input: 3, cacheRead: 0, cacheWrite: 0, output: 6, reasoning: 2 }]);
    expect(readOpencodeStoreUsage(join(fixture.dir, 'missing', 'x.db'), since)).toBeNull();
  });
});

const otlpLogs = (records: Array<Record<string, string | number>>) => ({
  resourceLogs: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }, { key: 'service.version', value: { stringValue: '2.1.268' } }] },
    scopeLogs: [{ logRecords: records.map((attrs) => ({ attributes: Object.entries(attrs).map(([key, value]) => ({
      key, value: typeof value === 'number' ? (Number.isInteger(value) ? { intValue: value } : { doubleValue: value }) : { stringValue: value },
    })) })) }],
  }],
});

describe('「＋ CLI」终端计量', () => {
  test('Claude 遥测的 api_request 解析出会话、序号与四类 Token（整数、字符串整数都接受）', () => {
    const parsed = parseClaudeNativeTelemetry('logs', otlpLogs([
      { 'event.name': 'api_request', 'session.id': 'ses-1', 'event.sequence': 0, model: 'claude-sonnet-4', input_tokens: '12', output_tokens: 30, cache_read_tokens: 400, cache_creation_tokens: 5, cost_usd: 0.01 },
      { 'event.name': 'tool_result', 'session.id': 'ses-1' },
    ]));
    expect(parsed).toEqual([{ type: 'api-request', sessionId: 'ses-1', sequence: 0, model: 'claude-sonnet-4', input: 12, output: 30, cacheRead: 400, cacheWrite: 5 }]);
  });

  test('Claude 终端按（会话, 序号）去重累加，来源缺口后为 partial', () => {
    const meter = createTerminalUsageMeter('claude-code', {}, Date.now());
    const request = { type: 'api-request' as const, sessionId: 's', sequence: 1, model: 'claude-sonnet-4', input: 10, output: 20, cacheRead: 0, cacheWrite: 0 };
    expect(meter.observeRequest(request)).toBe(true);
    expect(meter.observeRequest(request)).toBe(false);
    expect(meter.observeRequest({ ...request, sequence: 2, model: 'claude-haiku-4', input: 1, output: 1 })).toBe(true);
    expect(meter.observeRequest({ ...request, sequence: 3, input: 0, output: 0 })).toBe(false);
    expect(meter.read()).toEqual({ state: 'complete', models: [
      { model: 'claude-haiku-4', input: 1, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 },
      { model: 'claude-sonnet-4', input: 10, cacheRead: 0, cacheWrite: 0, output: 20, reasoning: 0 },
    ] });
    meter.degrade();
    expect(meter.read()?.state).toBe('partial');
  });

  test('OpenCode 终端：活动通道报告了根会话时只汇总这些会话树，否则汇总整库', () => {
    const fixture = nativeStore();
    const since = Date.now() - 1000;
    fixture.step('mine', null, since + 1, { input: 2, output: 1 });
    fixture.step('mine-child', 'mine', since + 2, { input: 3, output: 1 });
    fixture.step('foreign', null, since + 3, { input: 70, output: 7 });
    fixture.db.close();
    const whole = createTerminalUsageMeter('opencode', fixture.env, since);
    expect(whole.read()?.models[0]).toMatchObject({ input: 75, output: 9 });
    const scoped = createTerminalUsageMeter('opencode', fixture.env, since);
    scoped.observeSession('mine-child', 'mine');
    scoped.observeSession('mine', null);
    expect(scoped.read()).toEqual({ state: 'complete', models: [{ model: 'zhipu/glm-5', input: 5, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 }] });
    expect(createTerminalUsageMeter('opencode', { OPENCODE_DB: ':memory:' }, since).read()).toBeNull();
  });
});

test('业务 usage 事件：一次执行一个累计范围，四个总量为各模型合计', () => {
  const usage = businessUsageOf('run-1', { state: 'partial', models: [
    { model: 'a', input: 1, cacheRead: 2, cacheWrite: 3, output: 4, reasoning: 1 },
    { model: 'b', input: 10, cacheRead: 20, cacheWrite: 30, output: 40, reasoning: 0 },
  ] }, 3);
  expect(usage).toMatchObject({ measurementId: 'run-1:3', scope: 'run-1', mode: 'cumulative', inputTokens: 11, cacheReadTokens: 22, cacheWriteTokens: 33, outputTokens: 44, complete: false });
  expect(usage.snapshot?.models).toHaveLength(2);
});


test('OpenCode delegated usage translates private aliases to original model names after native tree reconciliation', () => {
  const f = nativeStore(), startedAt = Date.now() - 1000;
  const root = f.step('root', null, startedAt + 10, { input: 9, output: 3 }, ['cs-platform-root', 'a']);
  f.step('child', 'root', startedAt + 20, { input: 4, output: 2 }, ['cs-platform-child', 'b']);
  const meter = createOpencodeUsageMeter({ resumed: false, configuredModel: 'original/a', startedAt, env: f.env, modelAliases: { 'cs-platform-root/a': 'original/a', 'cs-platform-child/b': 'original/b' } });
  meter.observe(stepFinish('root', root, { input: 9, output: 3 })); meter.observe(taskTool('root'));
  expect(meter.snapshot().state).toBe('partial'); expect(meter.refresh?.()).toBe(true);
  expect(meter.snapshot().models.map((row) => [row.model, row.input, row.output])).toEqual([['original/a', 9, 3], ['original/b', 4, 2]]);
  expect(JSON.stringify(meter.snapshot())).not.toContain('cs-platform'); f.db.close();
});

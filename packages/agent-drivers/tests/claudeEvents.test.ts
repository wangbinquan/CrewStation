// 样本行取自 agent-workflow `runtime/claudeCode/events.ts` 的形状注释
// （实测于 claude 2.1.193／2.1.202／2.1.226）与其自检样本 `initEventSample`。
import { describe, expect, test } from 'bun:test';
import { detectClaudeSessionNotFound, observeSystemEvent, parseEvent } from '../drivers/claudeCode/events';
import { toAgentEvent } from '../drivers/agentEventMapping';
import { createAgentEventFactory } from '../drivers/agentEventMapping';

const INIT = '{"type":"system","subtype":"init","session_id":"sess-1","tools":["Read"],"agents":["general-purpose"],"skills":[],"mcp_servers":[]}';
const TEXT = '{"type":"assistant","parent_tool_use_id":null,"session_id":"sess-1","message":{"id":"msg_1","content":[{"type":"text","text":"你好"},{"type":"text","text":"，世界"}]}}';
const THINK = '{"type":"assistant","parent_tool_use_id":null,"session_id":"sess-1","message":{"id":"msg_2","content":[{"type":"thinking","thinking":"嗯"}]}}';
const TOOL_USE = '{"type":"assistant","parent_tool_use_id":null,"session_id":"sess-1","message":{"id":"msg_3","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/work/a.ts"}}]}}';
const TOOL_RESULT = '{"type":"user","parent_tool_use_id":null,"session_id":"sess-1","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok","is_error":false}]}}';
const SIDECHAIN = '{"type":"assistant","parent_tool_use_id":"toolu_1","session_id":"sess-child","message":{"content":[{"type":"text","text":"子代理"}]}}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"sess-1","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":2,"cache_creation_input_tokens":1}}';
const RESULT_ERROR = '{"type":"result","subtype":"error","is_error":true,"result":"Not logged in","session_id":"sess-1"}';

describe('Claude stream-json 解析', () => {
  test('非 JSON 行返回 null，由调用方走原样文本路径', () => {
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent('')).toBeNull();
    expect(parseEvent('"a string"')).toBeNull();
  });

  test('system/init：kind 为 step_start，贡献根会话 id', () => {
    const event = parseEvent(INIT);
    expect(event?.kind).toBe('step_start');
    expect(event?.sessionId).toBe('sess-1');
  });

  test('assistant 文本块串联；缺省时间戳留空由泵回退', () => {
    const event = parseEvent(TEXT);
    expect(event?.kind).toBe('text');
    expect(event?.text).toBe('你好，世界');
    expect(event?.sessionId).toBe('sess-1');
    expect(event?.timestamp).toBeUndefined();
  });

  test('纯思考回合判为 reasoning', () => {
    expect(parseEvent(THINK)?.kind).toBe('reasoning');
  });

  test('工具调用展开 callId／name／input', () => {
    const event = parseEvent(TOOL_USE);
    expect(event?.kind).toBe('tool_use');
    expect(event?.tool).toEqual({ callId: 'toolu_1', name: 'Read', input: { file_path: '/work/a.ts' } });
  });

  test('tool_result 回合判为 tool_result 并带回执', () => {
    const event = parseEvent(TOOL_RESULT);
    expect(event?.kind).toBe('tool_result');
    expect(event?.tool?.callId).toBe('toolu_1');
    expect(event?.tool?.isError).toBe(false);
  });

  test('子代理侧链帧不贡献根会话 id', () => {
    expect(parseEvent(SIDECHAIN)?.sessionId).toBeUndefined();
  });

  test('token 只取累计的 result.usage，逐回合 assistant 不计', () => {
    expect(parseEvent(TEXT)?.tokens).toBeUndefined();
    expect(parseEvent(RESULT)?.tokens).toEqual({ input: 10, output: 5, cacheRead: 2, cacheCreate: 1 });
  });

  test('result 事件带 terminalError；干净退出但 is_error 时有文案', () => {
    expect(parseEvent(RESULT)?.terminalError).toEqual({ isError: false, message: 'done' });
    expect(parseEvent(RESULT_ERROR)?.terminalError).toEqual({ isError: true, message: 'Not logged in' });
    expect(parseEvent(RESULT)?.kind).toBe('step_finish');
  });

  test('ISO 时间戳解析为 ms epoch', () => {
    const line = '{"type":"user","parent_tool_use_id":null,"session_id":"s","timestamp":"2026-09-12T01:02:03.000Z","message":{"content":[]}}';
    expect(parseEvent(line)?.timestamp).toBe(Date.parse('2026-09-12T01:02:03.000Z'));
  });
});

describe('Claude 系统事件观测', () => {
  test('只有 result 判定终止结果', () => {
    expect(observeSystemEvent(RESULT)).toEqual({ runtimeEventType: 'result', terminalResult: 'success' });
    expect(observeSystemEvent(RESULT_ERROR)).toEqual({ runtimeEventType: 'result', terminalResult: 'error' });
    expect(observeSystemEvent(INIT)).toEqual({ runtimeEventType: 'system', terminalResult: null });
    expect(observeSystemEvent('nope')).toEqual({ runtimeEventType: null, terminalResult: null });
  });
});

describe('归一事件 → AgentEvent', () => {
  test('文本、思考、工具、终止各自的落点', () => {
    const emit = createAgentEventFactory('agt-1');
    expect(toAgentEvent(parseEvent(TEXT)!, emit)?.type).toBe('text');
    expect(toAgentEvent(parseEvent(THINK)!, emit)).toBeNull(); // thinking 块没有可见文本
    expect(toAgentEvent(parseEvent(TOOL_USE)!, emit)?.type).toBe('tool-start');
    expect(toAgentEvent(parseEvent(TOOL_RESULT)!, emit)?.type).toBe('tool-end');
    // step_start／step_finish 不单独成事件：会话认领与终止由运行循环处理。
    expect(toAgentEvent(parseEvent(INIT)!, emit)).toBeNull();
    expect(toAgentEvent(parseEvent(RESULT)!, emit)).toBeNull();
  });

  test('seq 递增、时间戳沿用事件自带的值', () => {
    const emit = createAgentEventFactory('agt-1');
    const first = toAgentEvent(parseEvent(TEXT)!, emit);
    const second = toAgentEvent(parseEvent(TOOL_USE)!, emit);
    expect(first?.seq).toBe(1);
    expect(second?.seq).toBe(2);
    expect(first?.agentId).toBe('agt-1');
  });
});

describe('Claude 会话不存在判定', () => {
  test('两种实测措辞都能识别；空尾部不误报', () => {
    expect(detectClaudeSessionNotFound('No conversation found with session ID: abc')).toBe(true);
    expect(detectClaudeSessionNotFound('--resume requires a valid session ID; "x" is not a UUID and does not match any session title')).toBe(true);
    expect(detectClaudeSessionNotFound('')).toBe(false);
    expect(detectClaudeSessionNotFound('some other failure')).toBe(false);
  });
});

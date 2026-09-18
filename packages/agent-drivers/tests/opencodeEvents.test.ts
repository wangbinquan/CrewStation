// 样本行取自 agent-workflow `runtime/opencode/events.ts` 的形状注释与其 token 探测顺序
// （缓存计数的 `cache: {read, write}` 形态实测于 opencode 1.15.5+）。
import { describe, expect, test } from 'bun:test';
import { computeTokenDelta, extractErrorText, inferEventKind, observeSystemEvent, parseEvent } from '../drivers/opencode/events';
import { detectOpencodeSessionNotFound } from '../drivers/opencode/probe';
import { createAgentEventFactory, toAgentEvent } from '../drivers/agentEventMapping';

const TEXT = '{"type":"text","part":{"type":"text","text":"你好"},"sessionID":"ses_1","timestamp":1757640000000}';
const TEXT_FLAT = '{"type":"text","text":"旧形状","sessionID":"ses_1"}';
const REASONING = '{"type":"reasoning","part":{"type":"reasoning","text":"嗯"},"sessionID":"ses_1"}';
const TOOL = '{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"bash","callID":"call_1","state":{"status":"completed","input":{"command":"ls"},"output":"a.ts"}}}';
const PERMISSION = '{"type":"permission.asked","sessionID":"ses_1"}';
const STEP_FINISH = '{"type":"step_finish","sessionID":"ses_1","tokens":{"input":10,"output":5,"cache":{"read":2,"write":1}}}';
const STEP_FINISH_FLAT = '{"type":"step_finish","sessionID":"ses_1","tokens":{"input_tokens":7,"output_tokens":3,"cache_read":4,"cache_creation":6}}';

describe('OpenCode --format json 解析', () => {
  test('非 JSON 与 falsy 解析结果返回 null', () => {
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent('null')).toBeNull();
    expect(parseEvent('0')).toBeNull();
    expect(parseEvent('""')).toBeNull();
  });

  test('文本取 part.text，回退顶层 text；sessionID 每个事件都带', () => {
    expect(parseEvent(TEXT)).toMatchObject({ kind: 'text', text: '你好', sessionId: 'ses_1', timestamp: 1757640000000 });
    expect(parseEvent(TEXT_FLAT)?.text).toBe('旧形状');
  });

  test('kind 推断覆盖七种已知类型，其余归 text', () => {
    expect(inferEventKind({ type: 'tool_use' })).toBe('tool_use');
    expect(inferEventKind({ type: 'reasoning' })).toBe('reasoning');
    expect(inferEventKind({ type: 'permission.asked' })).toBe('permission_asked');
    expect(inferEventKind({ type: 'permission_asked' })).toBe('permission_asked');
    expect(inferEventKind({ type: 'error' })).toBe('error');
    expect(inferEventKind({ type: 'step_start' })).toBe('step_start');
    expect(inferEventKind({ type: 'step_finish' })).toBe('step_finish');
    expect(inferEventKind({ type: 'something-else' })).toBe('text');
  });

  test('工具事件尽力提取名字与回执', () => {
    const event = parseEvent(TOOL);
    expect(event?.kind).toBe('tool_use');
    expect(event?.tool).toEqual({ callId: 'call_1', name: 'bash', input: { command: 'ls' }, output: 'a.ts' });
  });

  test('token 兼容 cache 对象与旧的扁平键', () => {
    expect(parseEvent(STEP_FINISH)?.tokens).toEqual({ input: 10, output: 5, cacheRead: 2, cacheCreate: 1 });
    expect(parseEvent(STEP_FINISH_FLAT)?.tokens).toEqual({ input: 7, output: 3, cacheRead: 4, cacheCreate: 6 });
    expect(computeTokenDelta({ usage: { input_tokens: 1, output_tokens: 2 } })).toEqual({ input: 1, output: 2, cacheRead: 0, cacheCreate: 0 });
    expect(computeTokenDelta({ type: 'text' })).toBeNull();
  });

  test('step_finish 判为成功终止；其余事件不判定', () => {
    expect(observeSystemEvent(STEP_FINISH)).toEqual({ runtimeEventType: 'step_finish', terminalResult: 'success' });
    expect(observeSystemEvent(TEXT)).toEqual({ runtimeEventType: 'text', terminalResult: null });
  });
});

describe('OpenCode 归一事件 → AgentEvent', () => {
  test('文本、思考、工具、权限询问各自的落点', () => {
    const emit = createAgentEventFactory('agt-1');
    expect(toAgentEvent(parseEvent(TEXT)!, emit)?.type).toBe('text');
    expect(toAgentEvent(parseEvent(REASONING)!, emit)).toBeNull(); // reasoning 事件不带 part.text 时无可见文本
    expect(toAgentEvent(parseEvent(TOOL)!, emit)?.type).toBe('tool-start');
    expect(toAgentEvent(parseEvent(PERMISSION)!, emit)?.type).toBe('permission');
    expect(toAgentEvent(parseEvent(STEP_FINISH)!, emit)).toBeNull();
  });
});

describe('OpenCode 会话不存在判定', () => {
  test('error 行取厂商错误文案与 HTTP 状态作原因（2026-09-18 实机的两行原样）', () => {
    const freeTier = '{"type":"error","timestamp":1789722695771,"sessionID":"ses_1","error":{"name":"APIError","data":{"message":"Error from provider (Console): OpenCode\'s free tier can only be used from within OpenCode","statusCode":403,"isRetryable":false}}}';
    const unknownModel = '{"type":"error","sessionID":"ses_2","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_1"}}}';
    expect(parseEvent(freeTier)).toMatchObject({ kind: 'error', sessionId: 'ses_1', text: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode（HTTP 403）" });
    expect(parseEvent(unknownModel)?.text).toBe('Unexpected server error. Check server logs for details.');
    expect(extractErrorText({ type: 'error', error: { name: 'ProviderAuthError' } })).toBe('ProviderAuthError');
    expect(extractErrorText({ type: 'error' })).toBeNull();
    // 归一成 AgentEvent 后，错误文案就是这句原因，而不是「运行时报告错误」。
    expect(toAgentEvent(parseEvent(freeTier)!, createAgentEventFactory('agt-1'))?.error).toEqual({ code: 'runtime_error', message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode（HTTP 403）" });
  });

  test('四条措辞都能识别；空尾部不误报', () => {
    expect(detectOpencodeSessionNotFound('error: session not found')).toBe(true);
    expect(detectOpencodeSessionNotFound('Session ses_1 does not exist')).toBe(true);
    expect(detectOpencodeSessionNotFound('unknown session id')).toBe(true);
    expect(detectOpencodeSessionNotFound('no such session')).toBe(true);
    expect(detectOpencodeSessionNotFound('')).toBe(false);
    expect(detectOpencodeSessionNotFound('provider auth failed')).toBe(false);
  });
});

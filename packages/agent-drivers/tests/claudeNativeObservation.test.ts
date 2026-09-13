import { expect, test } from 'bun:test';
import { parseClaudeNativeHook, parseClaudeTranscriptNode } from '../drivers/claudeCode/nativeObservation';
import { parseClaudeNativeTelemetry } from '../drivers/claudeCode/nativeTelemetry';

test('原生 hooks 只保留关联字段，工具对象键序不影响匹配，嵌套与标识有界', () => {
  const input = { hook_event_name: 'PreToolUse', session_id: 's', prompt_id: 'p', tool_use_id: 't', tool_name: 'Read', tool_input: { b: 'sensitive', a: [1, 2] }, prompt: 'private prompt', tool_response: 'private response' };
  const result = parseClaudeNativeHook(input);
  expect(result.inputHash).toBe(parseClaudeNativeHook({ ...input, tool_input: { a: [1, 2], b: 'sensitive' } }).inputHash);
  expect(JSON.stringify(result)).not.toContain('sensitive');
  expect(JSON.stringify(result)).not.toContain('private');
  expect(() => parseClaudeNativeHook({ ...input, session_id: 'x'.repeat(97) })).toThrow();
  let nested: unknown = 'leaf'; for (let i = 0; i < 40; i++) nested = { child: nested };
  expect(() => parseClaudeNativeHook({ ...input, tool_input: nested })).toThrow('nesting');
});

test('transcript 只认显式 human origin，工具结果不冒充用户输入，版本漂移不继续猜', () => {
  const input = { uuid: 'u', parentUuid: null, sessionId: 's', version: '2.1.268', type: 'user', promptId: 'p', message: { content: 'private content' } };
  expect(parseClaudeTranscriptNode(input)?.humanPrompt).toBe(false);
  expect(parseClaudeTranscriptNode({ ...input, origin: { kind: 'human' } })?.humanPrompt).toBe(true);
  expect(JSON.stringify(parseClaudeTranscriptNode(input))).not.toContain('private');
  expect(parseClaudeTranscriptNode({ ...input, isSidechain: true })).toBeUndefined();
  expect(parseClaudeTranscriptNode({ type: 'file-history-snapshot' })).toBeUndefined();
  expect(() => parseClaudeTranscriptNode({ ...input, version: '9.0.0' })).toThrow();
});

const attrs = (fields: Record<string, string>) => Object.entries(fields).map(([key, value]) => ({ key, value: { stringValue: value } }));
const resource = { attributes: attrs({ 'service.name': 'claude-code', 'service.version': '2.1.268' }) };

test('OTel 严格关联 prompt 与根 interaction，忽略子工具和后台标题；不透传提示词或身份', () => {
  const log = { traceId: 'trace', spanId: 'root', attributes: attrs({ 'session.id': 's', 'prompt.id': 'p', 'event.name': 'user_prompt', prompt: 'private prompt', 'user.id': 'private identity' }) };
  expect(parseClaudeNativeTelemetry('logs', { resourceLogs: [{ resource, scopeLogs: [{ logRecords: [log] }] }] })).toEqual([{ type: 'prompt-trace', sessionId: 's', promptId: 'p', traceId: 'trace', spanId: 'root' }]);
  const root = { name: 'claude_code.interaction', traceId: 'trace', spanId: 'root', endTimeUnixNano: '100', status: { code: 0 }, attributes: attrs({ 'session.id': 's', 'parent.source': 'none' }) };
  const spans = [root, { ...root, name: 'claude_code.llm_request' }, { ...root, attributes: attrs({ 'session.id': 's', 'parent.source': 'task' }) }];
  expect(parseClaudeNativeTelemetry('traces', { resourceSpans: [{ resource, scopeSpans: [{ spans }] }] })).toEqual([{ type: 'interaction-ended', sessionId: 's', traceId: 'trace', spanId: 'root' }]);
  expect(() => parseClaudeNativeTelemetry('logs', { resourceLogs: [{ resource: { attributes: attrs({ 'service.name': 'claude-code', 'service.version': '9.0.0' }) }, scopeLogs: [] }] })).toThrow('Unsupported');
  expect(parseClaudeNativeTelemetry('metrics', { resourceMetrics: [{ resource, scopeMetrics: [] }] })).toEqual([{ type: 'heartbeat' }]);
});

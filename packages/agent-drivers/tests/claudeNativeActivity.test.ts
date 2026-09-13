import { expect, test } from 'bun:test';
import type { NativeActivitySignal } from '@crewstation/contracts';
import { NativeActivitySignalSchema } from '@crewstation/contracts';
import { ClaudeNativeActivity } from '../drivers/claudeCode/nativeActivity';
import type { ClaudeNativeHook } from '../drivers/claudeCode/nativeObservation';

function fixture() {
  const events: NativeActivitySignal[] = [];
  const activity = new ClaudeNativeActivity((event) => events.push(NativeActivitySignalSchema.parse(event)));
  const hook = (type: ClaudeNativeHook['type'], fields: Partial<ClaudeNativeHook> = {}) => activity.hook({ type, sessionId: 'session', promptId: 'prompt', child: false, ...fields });
  const end = (promptId = 'prompt', spanId = 'root') => {
    activity.telemetry({ type: 'interaction-ended', sessionId: 'session', traceId: 'trace', spanId });
    activity.telemetry({ type: 'prompt-trace', sessionId: 'session', promptId, traceId: 'trace', spanId });
  };
  hook('SessionStart'); hook('UserPromptSubmit');
  return { events, activity, hook, end, kinds: () => events.map((event) => event.kind) };
}

test('问题匹配唯一工具调用，原生回答恢复执行；根 trace 与最终 transcript 才确认完成', () => {
  const f = fixture(); const tool = { toolId: 'question', toolName: 'AskUserQuestion', inputHash: 'hash' };
  f.hook('PreToolUse', tool); f.hook('PermissionRequest', { toolName: tool.toolName, inputHash: tool.inputHash });
  f.hook('PermissionRequest', { toolName: tool.toolName, inputHash: tool.inputHash });
  expect(f.kinds()).toEqual(['source-ready', 'turn-started', 'request-opened']);
  f.hook('PostToolUse', tool);
  expect(f.events.at(-1)?.request).toEqual({ id: 'question', kind: 'question', resolution: 'answered' });
  expect(f.kinds()).not.toContain('turn-completed');
  const node = { sessionId: 'session', humanPrompt: false, assistant: false, turnDuration: false };
  f.activity.transcript({ ...node, id: 'u', parentId: null, humanPrompt: true, promptId: 'prompt' });
  f.activity.transcript({ ...node, id: 'a', parentId: 'u', assistant: true, assistantFinish: 'end_turn' });
  f.activity.transcript({ ...node, id: 'd', parentId: 'a', turnDuration: true });
  f.end(); f.end();
  expect(f.kinds().filter((kind) => kind === 'turn-completed')).toHaveLength(1);
});

test('问题撤回无 PostToolUseFailure，根轮次结束仍消除待处理但不假称回答或成功', () => {
  const f = fixture();
  f.hook('PreToolUse', { toolId: 'q', toolName: 'AskUserQuestion', inputHash: 'hash' });
  f.hook('PermissionRequest', { toolName: 'AskUserQuestion', inputHash: 'hash' });
  f.end();
  expect(f.events.at(-2)?.request).toEqual({ id: 'q', kind: 'question', resolution: 'withdrawn' });
  expect(f.events.at(-1)?.kind).toBe('turn-unconfirmed');
});

test('同输入的并行许可没有唯一 ID 时明确降级，不能 FIFO 拼接出错误待办', () => {
  const f = fixture();
  for (const toolId of ['one', 'two']) f.hook('PreToolUse', { toolId, toolName: 'Read', inputHash: 'same' });
  f.hook('PermissionRequest', { toolName: 'Read', inputHash: 'same' });
  expect(f.events.at(-1)).toMatchObject({ kind: 'source-unavailable', reason: 'unmatched-event' });
  f.end(); expect(f.kinds()).not.toContain('turn-completed');
});

test('子 Agent、其他会话与普通工具完成不替主轮次报告完成，失败关联原 prompt', () => {
  const f = fixture();
  f.hook('UserPromptSubmit', { sessionId: 'child', child: true });
  f.activity.telemetry({ type: 'interaction-ended', sessionId: 'child', traceId: 'other', spanId: 'other' });
  f.hook('StopFailure'); f.hook('UserPromptSubmit', { promptId: 'next' });
  f.end();
  expect(f.events.at(-1)).toMatchObject({ kind: 'turn-failed', turnId: 'session:prompt' });
  expect(f.kinds().filter((kind) => kind === 'turn-started')).toHaveLength(2);
});

test('旧轮次正常淘汰后不因保留的 trace 引入假缺口，结束关联缺失超时则降级', () => {
  const f = fixture(); f.end();
  for (let i = 0; i < 140; i++) { const promptId = `p-${i}`; f.hook('UserPromptSubmit', { promptId }); f.end(promptId, promptId); }
  f.activity.check(Date.now() + 30000);
  expect(f.kinds()).not.toContain('source-unavailable');
  f.activity.telemetry({ type: 'interaction-ended', sessionId: 'session', traceId: 'missing', spanId: 'missing' });
  f.activity.check(Date.now() + 30000);
  expect(f.events.at(-1)).toMatchObject({ kind: 'source-unavailable', reason: 'unmatched-event' });
});

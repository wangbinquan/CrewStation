import { expect, test } from 'bun:test';
import type { NativeActivitySignal, OpencodeActivityInput } from '@crewstation/contracts';
import { NativeActivitySignalSchema, OpencodeActivityInputSchema } from '@crewstation/contracts';
import { OpencodeNativeActivity } from '../drivers/opencode/nativeActivity';

const at = '2026-09-13T08:00:00.000Z';
function fixture() {
  const signals: NativeActivitySignal[] = [];
  const state = new OpencodeNativeActivity((signal) => signals.push(NativeActivitySignalSchema.parse(signal)));
  let seq = 0;
  const send = (input: Omit<OpencodeActivityInput, 'eventId' | 'at' | 'sessionId'> & Record<string, unknown>, sessionId = 'root') => state.accept(OpencodeActivityInputSchema.parse({ ...input, sessionId, eventId: `event-${++seq}`, at }));
  send({ type: 'session', parentId: null });
  const prompt = (messageId = 'user-1', sessionId = 'root') => send({ type: 'prompt', messageId }, sessionId);
  const assistant = (patch: Record<string, unknown> = {}, sessionId = 'root') => send({ type: 'assistant', messageId: 'assistant-1', parentId: 'user-1', createdAt: 1, completed: false, ...patch }, sessionId);
  return { state, signals, send, prompt, assistant, kinds: () => signals.map((signal) => signal.kind) };
}

test('正常结束需要最终 assistant 完成与 idle；tool-calls、工具结束和重复空闲不冒充整轮完成', () => {
  const f = fixture(); f.prompt(); f.send({ type: 'status', status: 'busy' });
  f.assistant({ finish: 'tool-calls', completed: true });
  f.send({ type: 'status', status: 'idle' });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed']);
  f.send({ type: 'status', status: 'busy' });
  f.assistant({ messageId: 'assistant-2', createdAt: 2, finish: 'stop' });
  f.assistant({ messageId: 'assistant-2', createdAt: 2, finish: 'stop', completed: true });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed', 'turn-started']);
  f.send({ type: 'status', status: 'idle' }); f.send({ type: 'status', status: 'idle' });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed', 'turn-started', 'turn-completed']);
});

test('真实中断顺序：idle 先于带 MessageAbortedError 的最终消息，不能产生成功', () => {
  const f = fixture(); f.prompt(); f.assistant();
  f.send({ type: 'status', status: 'idle' });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed']);
  f.assistant({ completed: true, error: 'MessageAbortedError' });
  f.assistant({ completed: true, finish: 'stop' });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed', 'turn-cancelled']);
});

test('多个原生问题分别打开与解决，回答和拒绝不等于整轮结果', () => {
  const f = fixture(); f.prompt(); f.assistant();
  for (const requestId of ['q-1', 'q-2']) f.send({ type: 'request', requestId, requestKind: 'question', messageId: 'assistant-1' });
  f.send({ type: 'resolved', requestId: 'q-1', resolution: 'answered' });
  f.send({ type: 'resolved', requestId: 'q-2', resolution: 'rejected' });
  f.send({ type: 'resolved', requestId: 'q-1', resolution: 'answered' });
  expect(f.kinds()).toEqual(['turn-started', 'request-opened', 'request-opened', 'request-resolved', 'request-resolved']);
  expect(f.signals.at(-1)?.request).toEqual({ id: 'q-2', kind: 'question', resolution: 'rejected' });
});

test('轮次取消或失败撤回所有未解决请求，明确引用请求 ID', () => {
  const f = fixture(); f.prompt(); f.assistant();
  f.send({ type: 'request', requestId: 'p-1', requestKind: 'permission', messageId: 'assistant-1' });
  f.assistant({ completed: true, error: 'APIError' }); f.send({ type: 'status', status: 'idle' });
  expect(f.kinds()).toEqual(['turn-started', 'request-opened', 'request-resolved', 'turn-failed']);
  expect(f.signals[2]?.request).toEqual({ id: 'p-1', kind: 'permission', resolution: 'withdrawn' });
});

test('子 Agent 不冒充主会话，旧轮次结果保留自身身份，新输入不会被旧消息覆盖', () => {
  const f = fixture(); f.send({ type: 'session', parentId: 'root' }, 'child');
  f.prompt('user-1', 'child'); f.assistant({ completed: true, finish: 'stop' }, 'child'); f.send({ type: 'status', status: 'idle' }, 'child');
  expect(f.signals).toEqual([]);
  f.prompt(); f.assistant({ completed: true, finish: 'stop' });
  f.prompt('user-2'); f.send({ type: 'status', status: 'idle' });
  expect(f.signals.map((s) => [s.kind, s.turnId])).toEqual([['turn-started', 'root:user-1'], ['turn-started', 'root:user-2'], ['turn-completed', 'root:user-1'], ['turn-unconfirmed', 'root:user-2']]);
});

test('重放及同一用户消息的元数据更新不创建新轮次；旧 assistant 更新不回退后续消息', () => {
  const f = fixture(); f.prompt(); f.prompt();
  f.assistant({ messageId: 'assistant-2', createdAt: 2 });
  f.assistant({ finish: 'stop', completed: true }); f.send({ type: 'status', status: 'idle' });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed']);
  f.assistant({ messageId: 'assistant-2', createdAt: 2, finish: 'stop', completed: true });
  expect(f.kinds()).toEqual(['turn-started', 'turn-unconfirmed', 'turn-completed']);
});

test('无法关联的请求或事件缺口只降级一次，缺口后不会伪造成功', () => {
  const f = fixture(); f.prompt();
  f.send({ type: 'request', requestId: 'q', requestKind: 'question' });
  f.state.gap(at, 'gap'); f.assistant({ completed: true, finish: 'stop' }); f.send({ type: 'status', status: 'idle' });
  expect(f.kinds()).toEqual(['turn-started', 'source-unavailable']);
  expect(f.signals[1]?.reason).toBe('unmatched-event');
});

test('有界名册不丢弃仍在执行的轮次，超限后降级；严格契约拒绝正文与缺少关联', () => {
  const f = fixture(); for (let i = 0; i < 129; i++) f.prompt(`user-${String(i).padStart(4, '0')}`);
  expect(f.signals.filter((s) => s.kind === 'turn-started')).toHaveLength(128);
  expect(f.signals.at(-1)?.reason).toBe('capacity');
  expect(NativeActivitySignalSchema.safeParse({ ...f.signals[0], text: 'private prompt' }).success).toBe(false);
  expect(NativeActivitySignalSchema.safeParse({ ...f.signals[0], turnId: null }).success).toBe(false);
});

test('下一轮 busy 不会把已停止但结果未确认的旧轮次恢复成执行中', () => {
  const f = fixture(); f.prompt(); f.assistant({ completed: true, finish: 'tool-calls' });
  f.send({ type: 'status', status: 'idle' });
  expect(f.signals.at(-1)?.kind).toBe('turn-unconfirmed');
  f.prompt('user-2'); f.send({ type: 'status', status: 'busy' });
  expect(f.signals.at(-1)).toMatchObject({ kind: 'turn-started', turnId: 'root:user-2' });
  expect(f.signals.filter((s) => s.kind === 'turn-started' && s.turnId === 'root:user-1')).toHaveLength(1);
});

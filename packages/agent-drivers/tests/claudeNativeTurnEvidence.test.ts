import { expect, test } from 'bun:test';
import { ClaudeNativeTurnEvidence, type ClaudeTranscriptNode, type ClaudeTurnOutcome } from '../drivers/claudeCode/nativeTurnEvidence';

function fixture() {
  const outcomes: Array<{ session: string; prompt: string; outcome: ClaudeTurnOutcome }> = [];
  let gaps = 0;
  const evidence = new ClaudeNativeTurnEvidence((session, prompt, outcome) => outcomes.push({ session, prompt, outcome }), () => { gaps++; });
  const observe = (id: string, parentId: string | null, fields: Partial<ClaudeTranscriptNode> = {}) => evidence.observe({ id, parentId, sessionId: 'session', humanPrompt: false, assistant: fields.assistantFinish !== undefined, turnDuration: false, ...fields });
  evidence.start('session', 'prompt');
  return { evidence, outcomes, observe, gaps: () => gaps };
}

test('正常回答需要用户父链、最终 assistant 和 interaction 结束，重复记录不重复发布', () => {
  const f = fixture();
  f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  f.observe('assistant', 'user', { assistantFinish: 'end_turn' });
  f.observe('duration', 'assistant', { turnDuration: true });
  expect(f.outcomes).toEqual([]);
  f.evidence.end('session', 'prompt'); f.evidence.end('session', 'prompt');
  f.observe('duration', 'assistant', { turnDuration: true });
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['completed']);
});

test('最后一条 assistant 没有结束原因时，不能借用更早的 end_turn 判定成功', () => {
  const f = fixture(); f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  f.observe('old-answer', 'user', { assistantFinish: 'end_turn' });
  f.observe('new-answer', 'old-answer', { assistant: true });
  f.observe('duration', 'new-answer', { turnDuration: true }); f.evidence.end('session', 'prompt');
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['unconfirmed']);
});

test('Stop block 后取消即使之前有最终回答，也不能因 interaction 结束误报完成', () => {
  const f = fixture();
  f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  f.observe('assistant', 'user', { assistantFinish: 'end_turn' });
  f.observe('interrupted', 'assistant', { promptId: 'prompt', interrupted: true });
  f.evidence.end('session', 'prompt');
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['cancelled']);
});

test('撤回问题也有 turn_duration，最后是 tool_use 时结果仍未确认；不把工具错误冒充整轮失败', () => {
  const f = fixture();
  f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  f.observe('question', 'user', { assistantFinish: 'tool_use' });
  f.observe('tool-error', 'question', { promptId: 'prompt' });
  f.observe('duration', 'tool-error', { turnDuration: true });
  f.evidence.end('session', 'prompt');
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['unconfirmed']);
});

test('新会话首次请求中断没有完整结果字段，已停止与成功严格分开', () => {
  const f = fixture(); f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  f.evidence.end('session', 'prompt');
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['unconfirmed']);
});

test('真实 transcript 可乱序追加：父链缺失时不猜，补齐后只确认匹配的旧轮次', () => {
  const f = fixture(); f.evidence.end('session', 'prompt');
  f.observe('duration', 'assistant', { turnDuration: true });
  f.evidence.start('session', 'next');
  f.observe('assistant', 'user', { assistantFinish: 'end_turn' });
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['unconfirmed']);
  f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  expect(f.outcomes).toEqual([{ session: 'session', prompt: 'prompt', outcome: 'unconfirmed' }, { session: 'session', prompt: 'prompt', outcome: 'completed' }]);
});

test('明确的原生 API 失败覆盖 end_turn 外观，跨会话父链和环不产生成功', () => {
  const f = fixture(); f.evidence.failure('session', 'prompt');
  f.observe('user', null, { humanPrompt: true, promptId: 'prompt' });
  f.observe('assistant', 'user', { assistantFinish: 'end_turn', apiError: true });
  f.observe('duration', 'assistant', { turnDuration: true }); f.evidence.end('session', 'prompt');
  expect(f.outcomes.map((item) => item.outcome)).toEqual(['failed']);
  const g = fixture(); g.observe('user', null, { humanPrompt: true, promptId: 'prompt', sessionId: 'other' });
  g.observe('assistant', 'user', { assistantFinish: 'end_turn' }); g.observe('duration', 'assistant', { turnDuration: true }); g.evidence.end('session', 'prompt');
  expect(g.outcomes.map((item) => item.outcome)).toEqual(['unconfirmed']);
  const h = fixture(); h.observe('one', 'two'); h.observe('two', 'one'); h.observe('duration', 'one', { turnDuration: true });
  expect(h.gaps()).toBe(1);
});

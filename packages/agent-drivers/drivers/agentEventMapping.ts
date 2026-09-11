// NormalizedEvent → 契约里的 AgentEvent。这一层在 agent-workflow 里没有对应实现：
// 源把归一事件直接落进自己的 execution_events 表，CrewStation 则要满足
// `packages/contracts/taskrunner/agentEvents.ts` 的 11 种事件类型。

import type { AgentEvent, AgentEventType } from '@crewstation/contracts';
import type { NormalizedEvent, NormalizedEventKind } from '../contract/normalizedEvent';

export type AgentEventFields = Partial<Omit<AgentEvent, 'agentId' | 'seq' | 'at' | 'type'>>;

/** 为单个 Agent 生成带递增 seq 与时间戳的事件（与 runtimes/task 的同名工厂同形）。 */
export function createAgentEventFactory(agentId: string): (type: AgentEventType, fields?: AgentEventFields, at?: number) => AgentEvent {
  let seq = 0;
  return (type, fields = {}, at) => {
    seq += 1;
    return { agentId, seq, at: new Date(at ?? Date.now()).toISOString(), type, ...fields };
  };
}

const KIND_TO_TYPE: Readonly<Record<NormalizedEventKind, AgentEventType | null>> = Object.freeze({
  text: 'text',
  reasoning: 'thinking',
  tool_use: 'tool-start',
  tool_result: 'tool-end',
  permission_asked: 'permission',
  error: 'error',
  // step_start（Claude 的 system 事件、opencode 的 step_start）只贡献会话 id 与状态，不单独成事件。
  step_start: null,
  // step_finish 的落点由调用方决定：oneshot 结束、交互式回到 waiting。
  step_finish: null,
});

/** 一条归一事件映射成 0 或 1 条 AgentEvent；返回 null 表示这条事件不单独呈现。 */
export function toAgentEvent(
  event: NormalizedEvent,
  emit: (type: AgentEventType, fields?: AgentEventFields, at?: number) => AgentEvent,
): AgentEvent | null {
  const type = KIND_TO_TYPE[event.kind];
  if (type === null) return null;
  const fields: AgentEventFields = { raw: event.rawLine };
  if (typeof event.text === 'string' && event.text.length > 0) fields.text = event.text;
  if (event.tool !== undefined) fields.tool = event.tool;
  if (event.kind === 'error') fields.error = { code: 'runtime_error', message: event.text ?? '运行时报告错误' };
  // text／thinking 两类事件没有文本就没有呈现价值（Claude 的空 assistant 分块）。
  if ((type === 'text' || type === 'thinking') && fields.text === undefined) return null;
  return emit(type, fields, event.timestamp);
}

/** 累加 token 用量，最终进 completed 事件的 `result.usage`。 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 };
}

export function accumulateTokens(usage: TokenUsage, event: NormalizedEvent): void {
  const delta = event.tokens;
  if (delta === undefined) return;
  usage.input += delta.input;
  usage.output += delta.output;
  usage.cacheCreate += delta.cacheCreate;
  usage.cacheRead += delta.cacheRead;
  usage.total = usage.input + usage.output + usage.cacheCreate + usage.cacheRead;
}

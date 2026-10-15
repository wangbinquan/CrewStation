// NormalizedEvent → 契约里的 AgentEvent。这一层在 agent-workflow 里没有对应实现：
// 源把归一事件直接落进自己的 execution_events 表，CrewStation 则要满足
// `packages/contracts/taskrunner/agentEvents.ts` 的 11 种事件类型。

import type { AgentEvent, AgentEventType, AgentUsageSnapshot } from '@crewstation/contracts';
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

/**
 * 终态事件 `result.usage` 的四个合计（与 RFC-034 v2 快照同源）：各模型相加，`total` 为四桶之和。
 * 快照为空（运行时尚未报告）时不给出，未知不写成 0。
 */
export function resultUsageOf(snapshot: AgentUsageSnapshot): Record<string, number> | undefined {
  if (snapshot.models.length === 0) return undefined;
  const sum = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => snapshot.models.reduce((total, row) => total + row[key], 0);
  const usage = { input: sum('input'), output: sum('output'), cacheCreate: sum('cacheWrite'), cacheRead: sum('cacheRead') };
  return { ...usage, total: usage.input + usage.output + usage.cacheCreate + usage.cacheRead };
}

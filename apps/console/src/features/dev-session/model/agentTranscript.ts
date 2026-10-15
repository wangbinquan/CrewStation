import type { AgentEvent, AgentEventType, AgentInstanceDto } from '@crewstation/contracts';

/** 一条记录；标签文案由组件按 type 查 i18n，模型层不放界面文案。 */
export interface TranscriptLine {
  readonly id: string;
  readonly type: AgentEventType;
  /** 事件自带的正文：文本增量、工具名、状态或错误信息。 */
  readonly body: string;
  readonly at: string;
  /** 工具调用出错，渲染成告警色。 */
  readonly failed: boolean;
}

export type TranscriptsByAgent = Readonly<Record<string, readonly TranscriptLine[]>>;

/** 每个 Agent 保留的最大行数：开发会话可能跑一整天，转录必须有界。 */
export const MAX_TRANSCRIPT_LINES = 600;
/** 连续文本合并后的单行上限，超出后另起一行。 */
const MAX_MERGED_BODY = 16_000;

function bodyOf(event: AgentEvent): string {
  switch (event.type) {
    case 'user-message':
    case 'text':
    case 'thinking':
    case 'permission':
      return event.text ?? '';
    case 'tool-start':
    case 'tool-end':
      return event.tool?.name ?? '';
    case 'status':
      return event.status ?? '';
    case 'session':
      return event.sessionId ?? '';
    case 'error':
      return event.error?.message ?? '';
    case 'completed':
      return event.result?.summary ?? '';
    default:
      return '';
  }
}

function lineOf(event: AgentEvent): TranscriptLine {
  // c55d1c25 之前的 Runner 把长协议行截到 8192 字符，解析失败后以无 raw 的 text 保存。
  // 仅兼容该旧 OpenCode 工具信封；正常原生文本带 raw，哪怕正文演示同样的 JSON 也不改类。
  const legacyTool = event.type === 'text' && event.raw === undefined && event.text?.length === 8192
    && /^\{"type":"tool_use","timestamp":\d+,"sessionID":"[^"\\]+","part":\{"type":"tool","tool":"[^"\\]+","callID":"[^"\\]+",/u.test(event.text);
  return { id: `${event.agentId}:${event.seq}`, type: legacyTool ? 'tool-start' : event.type, body: bodyOf(event), at: event.at, failed: event.tool?.isError === true };
}

/** 连续的 text 增量属于同一段输出，合并成一行；其余事件各占一行。 */
function mergeable(previous: TranscriptLine | undefined, line: TranscriptLine): previous is TranscriptLine {
  return previous !== undefined && previous.type === 'text' && line.type === 'text' && previous.body.length < MAX_MERGED_BODY;
}

export function appendAgentEvent(current: TranscriptsByAgent, event: AgentEvent): TranscriptsByAgent {
  const lines = current[event.agentId] ?? [];
  const previous = lines[lines.length - 1];
  const line = lineOf(event);
  const next = mergeable(previous, line)
    ? [...lines.slice(0, -1), { ...previous, body: previous.body + line.body }]
    : [...lines, line];
  return { ...current, [event.agentId]: next.slice(-MAX_TRANSCRIPT_LINES) };
}

export function appendAgentEvents(current: TranscriptsByAgent, events: readonly AgentEvent[]): TranscriptsByAgent {
  return events.reduce(appendAgentEvent, current);
}

/** 显式生命周期和等待信号应及时重读名册；说明性的 status 不推测执行。 */
const LIFECYCLE_TYPES: ReadonlySet<AgentEventType> = new Set<AgentEventType>(['started', 'session', 'permission', 'completed', 'cancelled', 'error']);
const EXECUTION_TYPES: ReadonlySet<AgentEventType> = new Set<AgentEventType>(['started', 'session', 'text', 'thinking', 'tool-start', 'tool-end']);

export function isLifecycleEvent(event: AgentEvent): boolean {
  return LIFECYCLE_TYPES.has(event.type) || event.type === 'status' && (event.status === 'waiting' || event.status === 'running');
}

/** 旧驱动下一轮可能直接输出文本或工具事件；只在开始输出时刷新，不能每个片段都查询。 */
export function isExecutionEvent(event: AgentEvent): boolean {
  return EXECUTION_TYPES.has(event.type) || event.type === 'status' && event.status === 'running';
}

/**
 * 需要订阅的 Agent 执行环境任务流（RFC-006：每个 Agent 一个执行环境，它的事件存在执行环境自己的任务下）。
 * 未结束的都订阅，生命周期信号才能及时刷新名册；已结束的只为选中的 Agent 订阅，按 seq 回放重建转录。
 * 没有执行环境的老 Agent 仍从开发会话的任务流读取，这里不列。
 */
export function executionStreamTaskIds(agents: readonly AgentInstanceDto[], selectedAgentId: string | undefined): readonly string[] {
  const ids = new Set<string>();
  for (const agent of agents) {
    if (agent.execution && (agent.execution.state !== 'finished' || agent.agentId === selectedAgentId)) ids.add(agent.execution.taskId);
  }
  return [...ids];
}

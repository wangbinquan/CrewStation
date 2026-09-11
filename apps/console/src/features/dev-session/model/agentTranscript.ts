import type { AgentEvent, AgentEventType } from '@crewstation/contracts';

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
  return { id: `${event.agentId}:${event.seq}`, type: event.type, body: bodyOf(event), at: event.at, failed: event.tool?.isError === true };
}

/** 连续的 text 增量属于同一段输出，合并成一行；其余事件各占一行。 */
function mergeable(previous: TranscriptLine | undefined, event: AgentEvent): previous is TranscriptLine {
  return previous !== undefined && previous.type === 'text' && event.type === 'text' && previous.body.length < MAX_MERGED_BODY;
}

export function appendAgentEvent(current: TranscriptsByAgent, event: AgentEvent): TranscriptsByAgent {
  const lines = current[event.agentId] ?? [];
  const previous = lines[lines.length - 1];
  const next = mergeable(previous, event)
    ? [...lines.slice(0, -1), { ...previous, body: previous.body + (event.text ?? '') }]
    : [...lines, lineOf(event)];
  return { ...current, [event.agentId]: next.slice(-MAX_TRANSCRIPT_LINES) };
}

export function appendAgentEvents(current: TranscriptsByAgent, events: readonly AgentEvent[]): TranscriptsByAgent {
  return events.reduce(appendAgentEvent, current);
}

/** 会改变 Agent 名册状态的事件。工具调用也不是文本，但一次运行能来几十条，不值得为它重读名册。 */
const LIFECYCLE_TYPES: ReadonlySet<AgentEventType> = new Set<AgentEventType>(['started', 'session', 'completed', 'cancelled', 'error']);

export function isLifecycleEvent(event: AgentEvent): boolean {
  return LIFECYCLE_TYPES.has(event.type);
}

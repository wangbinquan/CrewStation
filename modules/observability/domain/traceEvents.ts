import type { RunnerEvent, TraceEventDto } from '@crewstation/contracts';
import type { TraceStoredEvent } from './traceParts';

/**
 * 回放里逐条查看的事件种类：Agent 事件、启动前步骤、CLI 活动信号、终端关闭。平台自己执行的命令（execExited，
 * 工作台读分支、读文件时产生，一个会话可达数万条）、终端输出与文件变化不列。
 */
export const TRACE_EVENT_KINDS: RunnerEvent['kind'][] = ['agent', 'beforeStart', 'nativeActivity', 'terminalClosed'];

/** Agent 文字截到这个长度；完整输出在业务子任务的产物或 CLI 自己的会话里。 */
export const TRACE_TEXT_LIMIT = 2000;

const clip = (text: string) => (text.length > TRACE_TEXT_LIMIT ? `${text.slice(0, TRACE_TEXT_LIMIT)}…` : text);

/**
 * 把一条运行事件映射成回放条目；不在 TRACE_EVENT_KINDS 里的返回 undefined。
 * Design §14.2「默认不保留模型内部推理内容」：思考事件只留类型，不带文字。
 */
export function toTraceEvent(stored: TraceStoredEvent): TraceEventDto | undefined {
  const { seq, at, event } = stored;
  switch (event.kind) {
    case 'agent': {
      const a = event.event, text = a.type === 'thinking' ? undefined : a.text ?? a.result?.summary;
      return {
        seq, at: a.at, kind: 'agent', type: a.type, ...(text ? { text: clip(text) } : {}),
        ...(a.tool ? { tool: { name: a.tool.name, ...(a.tool.isError === undefined ? {} : { isError: a.tool.isError }) } } : {}),
        ...(a.status ? { status: a.status } : {}), ...(a.error ? { error: a.error.message } : {}), ...(a.sessionId ? { sessionId: a.sessionId } : {}),
        ...(a.result?.exitCode === undefined ? {} : { exitCode: a.result.exitCode }),
      };
    }
    case 'beforeStart': {
      const x = event.execution, step = x.steps.find((s) => s.stepId === (x.error?.stepId ?? x.currentStepId)) ?? x.steps.find((s) => s.state === 'failed');
      return { seq, at, kind: 'before-start', status: x.state, ...(step ? { text: step.name } : {}), ...(x.error ? { error: x.error.message } : {}) };
    }
    case 'nativeActivity': {
      const signal = event.activity.signal;
      return { seq, at: signal.occurredAt, kind: 'activity', status: signal.kind, ...(signal.nativeSessionId ? { sessionId: signal.nativeSessionId } : {}) };
    }
    case 'terminalClosed':
      return { seq, at, kind: 'terminal-closed', exitCode: event.exitCode };
    default:
      return undefined;
  }
}

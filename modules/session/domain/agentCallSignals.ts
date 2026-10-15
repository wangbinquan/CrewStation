// RFC-034 v2 §4 —— 从 Runner 事件里认出 Agent 执行的用量快照与终态（纯函数）：
//  - headless Agent：`usage` 事件带整份快照；`completed` / `cancelled` 与终结性的 `error` 结束执行，并带最终快照；
//    `runtime_error` 是运行时报告的中途错误（进程可能继续），不是终态；
//  - 「＋ CLI」终端：名册记录运行中带最新快照，结束记录带最终快照与原因。

import type { AgentEvent, AgentUsageSnapshot, NativeTerminalRecord, RunnerEvent } from '@crewstation/contracts';

export type AgentCallSignal =
  | { readonly kind: 'usage'; readonly agentId: string; readonly snapshot: AgentUsageSnapshot }
  | { readonly kind: 'finish'; readonly agentId: string; readonly status: 'done' | 'failed' | 'canceled' | 'interrupted'; readonly snapshot: AgentUsageSnapshot | null };

export function agentEventSignal(event: AgentEvent): AgentCallSignal | null {
  const snapshot = event.usageSnapshot ?? null;
  switch (event.type) {
    case 'usage': return snapshot ? { kind: 'usage', agentId: event.agentId, snapshot } : null;
    case 'completed': return { kind: 'finish', agentId: event.agentId, status: 'done', snapshot };
    case 'cancelled': return { kind: 'finish', agentId: event.agentId, status: 'canceled', snapshot };
    case 'error': return event.error?.code === 'runtime_error' ? null : { kind: 'finish', agentId: event.agentId, status: 'failed', snapshot };
    default: return null;
  }
}

export function terminalRecordSignal(record: NativeTerminalRecord): AgentCallSignal | null {
  const snapshot = record.usage ?? null;
  if (record.lifecycle === 'failed') return { kind: 'finish', agentId: record.agentId, status: 'failed', snapshot };
  if (record.lifecycle === 'ended') {
    const status = record.reason === 'stopped' ? 'canceled' : record.reason === 'runner-restarted' ? 'interrupted'
      : record.reason === 'exited' || record.reason === undefined ? (record.exitCode === 0 ? 'done' : 'failed') : 'failed';
    return { kind: 'finish', agentId: record.agentId, status, snapshot };
  }
  return record.lifecycle === 'running' && snapshot ? { kind: 'usage', agentId: record.agentId, snapshot } : null;
}

export function runnerEventSignal(event: RunnerEvent): AgentCallSignal | null {
  if (event.kind === 'agent') return agentEventSignal(event.event);
  if (event.kind === 'nativeTerminal') return terminalRecordSignal(event.terminal);
  return null;
}

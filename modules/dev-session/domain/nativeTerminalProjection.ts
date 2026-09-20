import type { NativeTerminalDto, NativeTerminalRecord, NativeTerminalRoster, TaskId, UserId } from '@crewstation/contracts';

interface StoredIdentity { taskId: TaskId; createdBy: UserId; clientRequestId: string; record: NativeTerminalRecord }

export function projectNativeTerminal(start: StoredIdentity, roster: NativeTerminalRoster | undefined, connection: NativeTerminalDto['connection'], at: string): NativeTerminalDto {
  const current = roster?.terminals.find((r) => r.agentId === start.record.agentId && r.terminalId === start.record.terminalId && r.runnerId === start.record.runnerId);
  const record = { ...(current ?? start.record), ...(start.record.computeName ? { computeName: start.record.computeName } : {}) };
  const identity = { taskId: start.taskId, createdBy: start.createdBy, clientRequestId: start.clientRequestId, connection };
  if (record.lifecycle === 'ended' || record.lifecycle === 'failed' || current) return { ...record, ...identity };
  if (roster && roster.runnerId !== record.runnerId) return { ...record, ...identity, revision: record.revision + 1, lifecycle: 'ended', endedAt: at, reason: 'runner-restarted' };
  return { ...record, ...identity, lifecycle: 'unknown' };
}

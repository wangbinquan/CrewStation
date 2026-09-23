import type { NativeTerminalDto, ResourcePhase, ResourceRecord } from '@crewstation/contracts';
import { terminalRecord } from '../../../../shared/resources/resourceViewState';

/** 名册里的一个 CLI，加上资源台账里它的 Agent 执行记录的阶段（RFC-025）；台账接上之前开的 CLI 没有记录，也就没有阶段。 */
export type RosterTerminal = NativeTerminalDto & { readonly phase?: ResourcePhase };

/**
 * 名册与台账合并（RFC-025 设计 §10）：结束与失败以台账为准——推送流一到，所有窗口同时看到「结束中」「已结束」，
 * 名册 10 秒一读跟不上也不会把关掉的 CLI 当成还在运行；启动与运行中的细节（RFC-022 启动进度、RFC-024 界面就绪）仍按名册。
 * 已结束时名册里的「失败」保留（重试入口在它上面），其余一律记为已结束。
 */
export function withRecordPhases(roster: NativeTerminalDto[] | undefined, records: readonly ResourceRecord[] | undefined): RosterTerminal[] | undefined {
  if (!roster || !records) return roster;
  return roster.map((terminal): RosterTerminal => {
    const record = terminalRecord(records, terminal.terminalId);
    if (!record) return terminal;
    if (record.phase === 'stopped') return { ...terminal, phase: 'stopped', lifecycle: terminal.lifecycle === 'failed' ? 'failed' : 'ended' };
    if (record.phase === 'failed') return { ...terminal, phase: 'failed', lifecycle: 'failed' };
    return { ...terminal, phase: record.phase };
  });
}

/** 已受理结束、进程还在收尾：标签写「结束中」，× 与「结束进程」不可再用。 */
export function isStoppingTerminal(terminal: Pick<RosterTerminal, 'phase'> | undefined): boolean {
  return terminal?.phase === 'stopping';
}

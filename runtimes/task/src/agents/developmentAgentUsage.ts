import type { AgentEvent, RunnerUsageCapture, StartAgentCommand } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import { validateDevelopmentStart } from './developmentStartIntent';
import type { DevelopmentUsageJournal } from './developmentUsageJournal';

/** Reserve FULL/WAL before any Hook; a replay only returns the original numeric receipt. */
export function reserveDevelopmentUsage(command: StartAgentCommand, journal?: DevelopmentUsageJournal): DevelopmentAgentUsage | undefined {
  if (!command.developmentUsage) return undefined;
  if (!journal) throw new RunnerCommandError('development_usage_unsupported', '当前 Runner 未提供开发数值日志');
  const admission = validateDevelopmentStart(command, command.developmentUsage);
  const reservation = journal.reserve(admission);
  return new DevelopmentAgentUsage(journal, admission.key, !reservation.created);
}

export class DevelopmentAgentUsage {
  private terminal = false;
  constructor(private readonly journal: DevelopmentUsageJournal, private readonly key: NonNullable<StartAgentCommand['developmentUsage']>['key'], readonly replayed: boolean) {}

  readonly capture = (capture: RunnerUsageCapture, occurredAt: string): void => {
    try { this.journal.capture(this.key, capture, occurredAt); }
    catch { this.journal.interrupt(this.key.executionId, 'journal-unavailable'); }
  };

  /** Final native capture has already been persisted by the driver before its terminal event. */
  observe(event: AgentEvent): boolean {
    if (event.type === 'usage') { if (event.usageCapture) this.capture(event.usageCapture, event.at); return false; }
    if (event.type === 'started') {
      try { this.journal.running(this.key); }
      catch { this.journal.interrupt(this.key.executionId, 'journal-unavailable'); }
    }
    if (event.type === 'completed' || event.type === 'error' || event.type === 'cancelled') this.finish(event.type);
    return true;
  }

  finish(result: 'completed' | 'error' | 'cancelled'): void {
    if (this.terminal) return;
    this.terminal = true;
    try { this.journal.finish(this.key, result); }
    catch { this.journal.interrupt(this.key.executionId, 'journal-unavailable'); }
  }

  readonly incomplete = (): void => {
    if (!this.terminal) this.journal.interrupt(this.key.executionId, 'missing-terminal');
  };
}

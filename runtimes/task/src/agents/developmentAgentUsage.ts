import type { DevelopmentNativeProducer } from '@crewstation/agent-drivers';
import type { AgentEvent, DevelopmentRunnerUsageCapture, StartAgentCommand } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import { validateDevelopmentStart } from './developmentStartIntent';
import type { DevelopmentUsageJournal } from './developmentUsageJournal';

/** Reserve FULL/WAL before any Hook; a replay only returns the original numeric receipt. */
export function reserveDevelopmentUsage(command: StartAgentCommand, journal?: DevelopmentUsageJournal, required?: boolean): DevelopmentAgentUsage | undefined {
  if (!command.developmentUsage) {
    if (required || journal) throw new RunnerCommandError('development_usage_required', '已选择开发数字布局，普通 Agent 启动必须携带原数字受理');
    return undefined;
  }
  if (!journal) throw new RunnerCommandError('development_usage_unsupported', '当前 Runner 未提供开发数值日志');
  const admission = validateDevelopmentStart(command, command.developmentUsage);
  const reservation = journal.reserve(admission);
  return new DevelopmentAgentUsage(journal, admission, !reservation.created);
}

export class DevelopmentAgentUsage {
  private terminal = false;
  constructor(private readonly journal: DevelopmentUsageJournal, private readonly admission: NonNullable<StartAgentCommand['developmentUsage']>, readonly replayed: boolean) {}
  private get key() { return this.admission.key; }
  matches(key: typeof this.key): boolean { const own = this.key; return key.executionId === own.executionId && key.journalId === own.journalId && key.incarnation === own.incarnation && key.payloadDigest === own.payloadDigest; }
  stop() { return this.journal.requestStop(this.admission, this.journal.context.podUid); }
  unprovenExit(): boolean { try { return this.journal.info(this.key).receipt?.interruption !== null; } catch { return true; } }
  readonly permitLaunch = (): boolean => {
    try { return this.journal.permitLaunch(this.key); }
    catch (error) { this.journal.interrupt(this.key.executionId, 'journal-unavailable'); throw error; }
  };

  get nativeProducer(): DevelopmentNativeProducer | undefined {
    if (this.admission.intent.nativeSource?.version !== 2) return undefined;
    return { lineageKey: this.admission.intent.nativeUsageLineageKey,
      beginTurn: (input) => this.journal.nativeBeginTurn(this.key, input),
      owner: (prepared, rootCreatedAt) => this.journal.nativeTurnOwner(this.key, prepared, rootCreatedAt),
      interrupted: () => { this.journal.interrupt(this.key.executionId, 'invalid-capture'); },
    };
  }

  readonly capture = (capture: DevelopmentRunnerUsageCapture, occurredAt: string): void => {
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

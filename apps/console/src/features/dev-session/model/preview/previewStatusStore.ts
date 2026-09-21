import type { PreviewStatusResult } from '@crewstation/api-client';
import type { PreviewAction } from '@crewstation/contracts';
import { RunnerEventSchema } from '@crewstation/contracts';
import { errorMessage } from '../../../../shared/api/useApi';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { UNKNOWN_PREVIEW, applyPreviewEvent } from '../previewSnapshot';

/**
 * RFC-016：状态读取与控制走 cs-api，与操作 MCP、CLI 同一条路由、同一处授权判定。
 * 事件仍从任务流来（见 `activate`），所以实时性不受影响。
 */
export interface PreviewCommands {
  status(): Promise<PreviewStatusResult>;
  control(action: PreviewAction): Promise<PreviewStatusResult>;
}

interface PreviewSnapshot {
  readonly status: PreviewStatusResult;
  readonly busy: boolean;
  readonly confirmed: boolean;
  readonly loadError?: string;
  /** 上一次控制动作没能确认；`actionLabel` 用来在文案里说清是哪个动作。 */
  readonly actionError?: string;
  readonly actionLabel?: PreviewAction;
}

/** 一个连接世代的预览事实；快照不得覆盖请求发出后收到的状态事件。 */
export class PreviewStatusStore {
  private state: PreviewSnapshot = { status: UNKNOWN_PREVIEW, busy: false, confirmed: false };
  private readonly listeners = new Set<() => void>();
  private active = false;
  private ticket = 0;
  private eventRevision = 0;
  private unsubscribe: (() => void) | undefined;
  constructor(
    private readonly channel: Pick<TaskStreamChannel, 'subscribe'>,
    private readonly commands: PreviewCommands,
    private readonly source: { connected: boolean; generation: number },
  ) {}
  getSnapshot = (): PreviewSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PreviewSnapshot>): void {
    this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener();
  }
  private current(ticket: number): boolean { return this.active && this.source.connected && ticket === this.ticket; }
  activate = (): void => {
    if (this.active) return; this.active = true;
    if (!this.source.connected) return;
    this.unsubscribe = this.channel.subscribe((event) => {
      if (event.kind !== 'previewState' || !this.active) return;
      this.eventRevision += 1;
      const parsed = RunnerEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.kind !== 'previewState') { this.update({ confirmed: false, loadError: '预览状态事件无效，请刷新状态。' }); return; }
      this.update({ status: applyPreviewEvent(this.state.status, parsed.data), confirmed: true, loadError: undefined });
    });
    this.refresh();
  };
  deactivate = (): void => {
    this.active = false; this.ticket += 1; this.unsubscribe?.(); this.unsubscribe = undefined;
    this.update({ busy: false, confirmed: false });
  };
  private async read(ticket: number): Promise<void> {
    if (!this.current(ticket)) return;
    const revision = this.eventRevision;
    try {
      const status = await this.commands.status();
      if (this.current(ticket) && revision === this.eventRevision) this.update({ status, confirmed: true, loadError: undefined });
    } catch (cause) {
      if (this.current(ticket) && revision === this.eventRevision) this.update({ confirmed: false, loadError: errorMessage(cause) });
    } finally { if (this.current(ticket)) this.update({ busy: false }); }
  }
  refresh = (): void => {
    if (!this.active || !this.source.connected || this.state.busy) return;
    this.update({ busy: true }); void this.read(++this.ticket);
  };
  run = (action: PreviewAction): void => {
    if (!this.active || !this.source.connected || this.state.busy) return;
    this.update({ busy: true, confirmed: false, actionError: undefined, actionLabel: undefined });
    void this.runAction(++this.ticket, action);
  };
  private async runAction(ticket: number, action: PreviewAction): Promise<void> {
    // 动作的回执也带状态，但这里仍统一回读一次：`read` 里有「不得覆盖请求发出后到达的事件」那道判定，
    // 直接用回执会绕过它。多一次往返换掉一类竞态，值得。
    try { await this.commands.control(action); }
    catch (cause) { if (this.current(ticket)) this.update({ actionError: errorMessage(cause), actionLabel: action }); }
    finally { if (this.current(ticket)) await this.read(ticket); }
  }
}

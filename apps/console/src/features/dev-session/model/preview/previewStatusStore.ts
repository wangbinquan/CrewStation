import type { PreviewStatusResult } from '@crewstation/api-client';
import { RunnerEventSchema } from '@crewstation/contracts';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { UNKNOWN_PREVIEW, applyPreviewEvent } from '../previewSnapshot';
import { asPreviewStatusResult } from '../runnerResults';
import { streamErrorMessage } from '../runnerErrors';

interface PreviewSnapshot {
  readonly status: PreviewStatusResult;
  readonly busy: boolean;
  readonly confirmed: boolean;
  readonly loadError?: string;
  readonly restartError?: string;
}

/** 一个连接世代的预览事实；快照不得覆盖请求发出后收到的状态事件。 */
export class PreviewStatusStore {
  private state: PreviewSnapshot = { status: UNKNOWN_PREVIEW, busy: false, confirmed: false };
  private readonly listeners = new Set<() => void>();
  private active = false;
  private ticket = 0;
  private eventRevision = 0;
  private unsubscribe: (() => void) | undefined;
  constructor(private readonly channel: TaskStreamChannel, private readonly source: { connected: boolean; generation: number }) {}
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
      const status = asPreviewStatusResult(await this.channel.send({ type: 'previewStatus' }));
      if (this.current(ticket) && revision === this.eventRevision) this.update({ status, confirmed: true, loadError: undefined });
    } catch (cause) {
      if (this.current(ticket) && revision === this.eventRevision) this.update({ confirmed: false, loadError: streamErrorMessage(cause) });
    } finally { if (this.current(ticket)) this.update({ busy: false }); }
  }
  refresh = (): void => {
    if (!this.active || !this.source.connected || this.state.busy) return;
    this.update({ busy: true }); void this.read(++this.ticket);
  };
  restart = (): void => {
    if (!this.active || !this.source.connected || this.state.busy) return;
    this.update({ busy: true, confirmed: false, restartError: undefined }); void this.runRestart(++this.ticket);
  };
  private async runRestart(ticket: number): Promise<void> {
    try { await this.channel.send({ type: 'restartPreview' }); }
    catch (cause) { if (this.current(ticket)) this.update({ restartError: streamErrorMessage(cause) }); }
    finally { if (this.current(ticket)) await this.read(ticket); }
  }
}

import type { RunnerEvent, TerminalSnapshot } from '@crewstation/contracts';
import { TerminalControlSchema, TerminalSnapshotSchema } from '@crewstation/contracts';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { streamErrorMessage } from '../runnerErrors';

type Delta = Extract<RunnerEvent, { kind: 'terminalOutput' | 'terminalResized' }>;
export interface NativeTerminalSink {
  restore(snapshot: TerminalSnapshot): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}
export interface NativeAttachmentState {
  phase: 'offline' | 'attaching' | 'ready' | 'error';
  controlled: boolean;
  truncated: boolean;
  error?: string;
}

/** 先订阅再取屏幕快照，按终端 seq 衔接；任何缺口都重新附着，不重放输入或启动进程。 */
export class NativeTerminalAttachment {
  private state: NativeAttachmentState = { phase: 'offline', controlled: false, truncated: false };
  private readonly listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private connected = false;
  private disposed = false;
  private generation = 0;
  private seq = 0;
  private buffered: Delta[] = [];
  private bufferedBytes = 0;
  private overflow = false;
  private refreshPromise?: Promise<void>;
  private leaseTimer?: ReturnType<typeof setInterval>;
  constructor(private readonly channel: TaskStreamChannel, readonly terminalId: string, readonly runnerId: string, private readonly sink: NativeTerminalSink) {
  }
  start(): void { this.disposed = false; this.unsubscribe ??= this.channel.subscribe((event) => this.receive(event)); }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  connect(): void { this.connected = true; void this.refresh(); }
  disconnect(): void {
    this.connected = false; this.generation++; this.refreshPromise = undefined; this.buffered = [];
    this.releaseLease(); this.patch({ phase: 'offline', controlled: false });
  }
  readonly refresh = (): Promise<void> => {
    if (this.disposed || !this.connected) return Promise.resolve();
    if (this.refreshPromise) return this.refreshPromise;
    const generation = ++this.generation;
    this.buffered = []; this.bufferedBytes = 0; this.overflow = false;
    this.patch({ phase: 'attaching', error: undefined });
    this.refreshPromise = this.channel.send({ type: 'attachTerminal', terminalId: this.terminalId, runnerId: this.runnerId }).then(async (raw) => {
      const snapshot = TerminalSnapshotSchema.parse(raw);
      if (snapshot.terminalId !== this.terminalId || snapshot.runnerId !== this.runnerId) throw new Error('终端快照与当前 CLI 不匹配');
      if (!this.current(generation)) return;
      await this.sink.restore(snapshot);
      if (!this.current(generation)) return;
      this.seq = snapshot.throughSeq;
      const buffered = this.buffered.sort((a, b) => (a.terminalSeq ?? 0) - (b.terminalSeq ?? 0));
      this.buffered = [];
      if (this.overflow) throw new Error('终端恢复期间输出超过缓冲上限，请重新附着');
      for (const event of buffered) this.apply(event);
      this.patch({ phase: 'ready', truncated: snapshot.truncated, error: undefined });
    }).catch((error: unknown) => { if (this.current(generation)) { this.releaseLease(); this.patch({ phase: 'error', controlled: false, error: streamErrorMessage(error) }); } })
      .finally(() => { if (this.current(generation)) this.refreshPromise = undefined; });
    return this.refreshPromise;
  };
  readonly claim = async (): Promise<boolean> => {
    if (this.disposed || !this.connected || this.state.phase !== 'ready') return false;
    const generation = this.generation;
    try {
      const control = TerminalControlSchema.parse(await this.channel.send({ type: 'claimTerminalControl', terminalId: this.terminalId, runnerId: this.runnerId, viewId: 'browser' }));
      if (!this.current(generation)) return false;
      this.releaseLease();
      this.patch({ controlled: control.controlled, error: control.controlled ? undefined : '另一窗口正在输入；其释放控制后可再次获取' });
      if (control.controlled) this.leaseTimer = setInterval(() => void this.claim(), 10_000);
      return control.controlled;
    } catch (error) { if (this.current(generation)) { this.releaseLease(); this.patch({ controlled: false, error: streamErrorMessage(error) }); } return false; }
  };
  input(data: string): void {
    if (!this.canInput()) return;
    // 不保留、排队或自动重发终端输入；网络回执丢失时原生 CLI 的实际屏幕是结果。
    this.command({ type: 'terminalInput', terminalId: this.terminalId, data });
  }
  resize(cols: number, rows: number): void {
    if (this.canInput()) this.command({ type: 'terminalResize', terminalId: this.terminalId, cols: Math.max(10, Math.min(300, cols)), rows: Math.max(2, Math.min(120, rows)) });
  }
  dispose(): void {
    this.disposed = true; this.generation++; this.releaseLease(); this.unsubscribe?.(); this.unsubscribe = undefined;
    this.refreshPromise = undefined;
    if (this.connected) void this.channel.send({ type: 'detachTerminal', terminalId: this.terminalId, viewId: 'browser' }).catch(() => undefined);
    this.listeners.clear(); this.buffered = [];
  }
  private current(generation: number): boolean { return !this.disposed && this.connected && generation === this.generation; }
  private canInput(): boolean { return this.connected && !this.disposed && this.state.phase === 'ready' && this.state.controlled; }
  private releaseLease(): void { if (this.leaseTimer) clearInterval(this.leaseTimer); this.leaseTimer = undefined; }
  private command(input: Parameters<TaskStreamChannel['send']>[0]): void {
    void this.channel.send(input).catch((error: unknown) => {
      if (this.disposed) return;
      this.releaseLease(); this.patch({ controlled: false, error: streamErrorMessage(error) });
    });
  }
  private receive(event: RunnerEvent): void {
    if (this.disposed || !this.connected || event.kind !== 'terminalOutput' && event.kind !== 'terminalResized') return;
    if (event.terminalId !== this.terminalId || event.runnerId !== this.runnerId) return;
    if (this.state.phase === 'attaching') {
      this.bufferedBytes += event.kind === 'terminalOutput' ? event.data.length * 2 : 32;
      if (this.buffered.length >= 512 || this.bufferedBytes > 2 * 1024 * 1024) { this.overflow = true; return; }
      this.buffered.push(event); return;
    }
    if (this.state.phase !== 'ready') return;
    try { this.apply(event); } catch { void this.refresh(); }
  }
  private apply(event: Delta): void {
    if (event.terminalSeq === undefined) throw new Error('终端事件缺少恢复序号');
    if (event.terminalSeq <= this.seq) return;
    if (event.terminalSeq !== this.seq + 1) throw new Error('终端输出有缺口，请重新附着');
    this.seq = event.terminalSeq;
    if (event.kind === 'terminalOutput') this.sink.write(event.data);
    else this.sink.resize(event.cols, event.rows);
  }
  private patch(change: Partial<NativeAttachmentState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
}

import type { RunnerEvent, TerminalControlState, TerminalSnapshot } from '@crewstation/contracts';
import { TerminalControlSchema, TerminalSnapshotSchema } from '@crewstation/contracts';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { isStreamCommandError, streamErrorMessage } from '../runnerErrors';

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
  /** 新 Runner 给出的当前输入控制（谁在输入）；旧 Runner 没有，保持 undefined。 */
  control?: TerminalControlState;
  /** 最近一次取得被拒：旧 Runner 看不到是谁，只能据此提示「其他窗口正在输入」。 */
  refused: boolean;
}

/** 持有控制时的续约间隔；Runner 的租约是 30 秒。 */
export const CONTROL_RENEW_MS = 10_000;
/**
 * 离开终端多久后主动释放。不能只等 Runner 的租约到期：原生 TUI 会不时查询终端（能力、光标位置、配色），
 * xterm 的自动应答走 terminalInput，每一条都会续租，人走了租约也可能一直不到期（2026-09-23 实机：离开 8 秒后一串应答把释放推迟到 39.5 秒）。
 */
export const CONTROL_RELEASE_MS = 30_000;
/** 连续点击或按键不重复发取得命令；被拒后也不每个按键都去撞一次。 */
const CLAIM_THROTTLE_MS = 1_000;

const newer = (current: TerminalControlState | undefined, next: TerminalControlState): TerminalControlState => !current || next.revision >= current.revision ? next : current;

/**
 * 先订阅再取屏幕快照，按终端 seq 衔接；任何缺口都重新附着，不重放输入或启动进程。
 * 输入控制（2026-09-23 裁定）：操作终端即自动取得（`ensureControl`），只在终端处于活动状态（有焦点、页面在前台）时续约，
 * 离开 `CONTROL_RELEASE_MS` 后主动释放（页面关掉、断线时才靠 Runner 的租约兜底）；谁在输入由 Runner 推来的 `terminalControl` 实时更新。
 */
export class NativeTerminalAttachment {
  private state: NativeAttachmentState = { phase: 'offline', controlled: false, truncated: false, refused: false };
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
  private claimPromise?: Promise<boolean>;
  private lastClaimAt = 0;
  /** 自己这次取得时 Runner 给的序号；之后出现更大的序号就是换了人、释放或到期。 */
  private ownRevision?: number;
  private active = false;
  /** CLI 进程是否已拉起（RFC-022）：拉起前 Runner 只接受「取得」，输入与改尺寸都会被拒，先不发；尺寸记下来拉起后补一次。 */
  private processRunning = true;
  private pendingSize?: { cols: number; rows: number };
  private renewTimer?: ReturnType<typeof setInterval>;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private readonly now: () => number;
  private readonly renewMs: number;
  private readonly releaseMs: number;
  constructor(private readonly channel: TaskStreamChannel, readonly terminalId: string, readonly runnerId: string, private readonly sink: NativeTerminalSink, options: { readonly now?: () => number; readonly renewMs?: number; readonly releaseMs?: number } = {}) {
    this.now = options.now ?? Date.now; this.renewMs = options.renewMs ?? CONTROL_RENEW_MS; this.releaseMs = options.releaseMs ?? CONTROL_RELEASE_MS;
  }
  start(): void { this.disposed = false; this.unsubscribe ??= this.channel.subscribe((event) => this.receive(event)); }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  connect(): void { this.connected = true; void this.refresh(); }
  disconnect(): void {
    this.connected = false; this.generation++; this.refreshPromise = undefined; this.claimPromise = undefined; this.buffered = [];
    this.loseControl(); this.patch({ phase: 'offline', control: undefined, refused: false });
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
      if (snapshot.control) this.acceptControl(snapshot.control);
    }).catch((error: unknown) => { if (this.current(generation)) { this.loseControl(); this.patch({ phase: 'error', error: streamErrorMessage(error) }); } })
      .finally(() => { if (this.current(generation)) this.refreshPromise = undefined; });
    return this.refreshPromise;
  };
  /**
   * 操作终端（点击、聚焦、按键）时调用：没有控制就去取；已持有则顺带续约。并发与连击只发一次。
   * quiet：创建者窗口的自动取得（RFC-022 D1）——旧 Runner 在 CLI 启动中会拒绝，不当作错误显示，拉起后再取。
   */
  readonly ensureControl = (options: { readonly quiet?: boolean } = {}): Promise<boolean> => {
    if (this.disposed || !this.connected || this.state.phase !== 'ready') return Promise.resolve(false);
    if (this.claimPromise) return this.claimPromise;
    // 节流只对「已持有（顺带续约）」与「刚被拒」生效；刚失去控制要马上能重新取得。
    if (this.now() - this.lastClaimAt < CLAIM_THROTTLE_MS && (this.state.controlled || this.state.refused)) return Promise.resolve(this.state.controlled);
    this.claimPromise = this.claim(options).finally(() => { this.claimPromise = undefined; });
    return this.claimPromise;
  };
  readonly claim = async (options: { readonly quiet?: boolean } = {}): Promise<boolean> => {
    if (this.disposed || !this.connected || this.state.phase !== 'ready') return false;
    const generation = this.generation;
    this.lastClaimAt = this.now();
    try {
      const result = TerminalControlSchema.parse(await this.channel.send({ type: 'claimTerminalControl', terminalId: this.terminalId, runnerId: this.runnerId, viewId: 'browser' }));
      if (!this.current(generation)) return false;
      const control = result.control ? newer(this.state.control, result.control) : this.state.control;
      // 回执之前已收到更新的换人事件（同一用户的另一窗口刚接走）：这次取得已经作废。
      const controlled = result.controlled && !(result.control && control && control.revision > result.control.revision);
      this.ownRevision = controlled ? result.control?.revision : undefined;
      this.patch({ controlled, refused: !result.controlled, error: undefined, ...(control ? { control } : {}) });
      this.syncRenewal();
      return controlled;
    } catch (error) { if (this.current(generation)) { this.loseControl(); if (!options.quiet) this.patch({ error: streamErrorMessage(error) }); } return false; }
  };
  /** 终端是否处于活动状态（有焦点且页面在前台）；只有活动时才续约，离开满 `CONTROL_RELEASE_MS` 主动释放。 */
  setActive(active: boolean): void { this.active = active; this.syncRenewal(); }
  /** RFC-022：CLI 进程拉起之前不发输入与改尺寸；拉起时持有控制就把记下的尺寸补发一次，让 CLI 按这个窗口的大小画第一屏。 */
  setProcessRunning(running: boolean): void {
    const started = running && !this.processRunning;
    this.processRunning = running;
    if (started && this.pendingSize) { const { cols, rows } = this.pendingSize; this.pendingSize = undefined; this.resize(cols, rows); }
  }
  input(data: string): void {
    if (!this.processRunning) return;
    if (!this.canInput()) { void this.ensureControl(); return; }
    // 不保留、排队或自动重发终端输入；网络回执丢失时原生 CLI 的实际屏幕是结果。
    this.command({ type: 'terminalInput', terminalId: this.terminalId, data });
  }
  resize(cols: number, rows: number): void {
    if (!this.processRunning) { this.pendingSize = { cols, rows }; return; }
    if (this.canInput()) this.command({ type: 'terminalResize', terminalId: this.terminalId, cols: Math.max(10, Math.min(300, cols)), rows: Math.max(2, Math.min(120, rows)) });
  }
  dispose(): void {
    this.disposed = true; this.generation++; this.stopRenewal(); this.clearRelease(); this.unsubscribe?.(); this.unsubscribe = undefined;
    this.refreshPromise = undefined; this.claimPromise = undefined;
    if (this.connected) void this.channel.send({ type: 'detachTerminal', terminalId: this.terminalId, viewId: 'browser' }).catch(() => undefined);
    this.listeners.clear(); this.buffered = [];
  }
  private current(generation: number): boolean { return !this.disposed && this.connected && generation === this.generation; }
  private canInput(): boolean { return this.connected && !this.disposed && this.state.phase === 'ready' && this.state.controlled; }
  private syncRenewal(): void {
    if (this.state.controlled && this.active) { this.clearRelease(); this.renewTimer ??= setInterval(() => void this.claim(), this.renewMs); return; }
    this.stopRenewal();
    if (this.state.controlled) this.releaseTimer ??= setTimeout(() => this.release(), this.releaseMs);
    else this.clearRelease();
  }
  private stopRenewal(): void { if (this.renewTimer) clearInterval(this.renewTimer); this.renewTimer = undefined; }
  private clearRelease(): void { if (this.releaseTimer) clearTimeout(this.releaseTimer); this.releaseTimer = undefined; }
  /** detach 只释放输入控制，画面照常附着；Runner 随即推「已空闲」。 */
  private release(): void {
    this.releaseTimer = undefined;
    if (this.disposed || !this.connected || this.active || !this.state.controlled) return;
    void this.channel.send({ type: 'detachTerminal', terminalId: this.terminalId, viewId: 'browser' }).catch(() => undefined);
    this.loseControl();
  }
  private loseControl(): void { this.stopRenewal(); this.clearRelease(); this.ownRevision = undefined; if (this.state.controlled) this.patch({ controlled: false }); }
  private acceptControl(control: TerminalControlState): void {
    const latest = newer(this.state.control, control);
    if (latest !== control) return;
    // 自己取得之后出现更大的序号：被同一用户的另一窗口接走、被释放或租约到期。
    if (this.state.controlled && this.ownRevision !== undefined && control.revision > this.ownRevision) this.loseControl();
    this.patch({ control, ...(control.held ? {} : { refused: false }) });
  }
  private command(input: Parameters<TaskStreamChannel['send']>[0]): void {
    void this.channel.send(input).catch((error: unknown) => {
      if (this.disposed) return;
      this.loseControl();
      // 离开终端后租约已到期（旧 Runner 不推送），用户回来直接打字：Runner 的拒绝经 cs-session 到这里只剩 `precondition`，
      // 不报错，按「操作终端」重新取得；CLI 已结束之类的真实原因会在取得失败时显示出来。
      if (isStreamCommandError(error) && error.code === 'precondition') { void this.ensureControl(); return; }
      this.patch({ error: streamErrorMessage(error) });
    });
  }
  private receive(event: RunnerEvent): void {
    if (this.disposed || !this.connected) return;
    if (event.kind === 'terminalControl') {
      // 附着途中到达的也要收：快照里的控制状态可能比它旧，按序号取新的。
      if (event.terminalId === this.terminalId && event.runnerId === this.runnerId && (this.state.phase === 'ready' || this.state.phase === 'attaching')) this.acceptControl(event.control);
      return;
    }
    if (event.kind !== 'terminalOutput' && event.kind !== 'terminalResized') return;
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

import type { SaveWorkspaceLayoutRequest, WorkspaceLayout, WorkspaceLayoutDto } from '@crewstation/contracts';
import { isApiClientError } from '@crewstation/api-client';
import { errorMessage } from '../../../../shared/api/useApi';

export interface LayoutTransport {
  get(signal: AbortSignal): Promise<WorkspaceLayoutDto>;
  save(input: SaveWorkspaceLayoutRequest, signal: AbortSignal): Promise<WorkspaceLayoutDto>;
}
/**
 * 一次读写最多等这么久，到时取消请求、按失败处理：草稿保留，可以重新应用（先核对服务端）或采用已保存布局。
 * 2026-09-23 实机：一次保存在服务端挂了 490 秒，写请求串行，后面的保存全排在它后面，关掉的 CLI 迟迟没有落库。
 */
export const LAYOUT_REQUEST_TIMEOUT_MS = 15_000;
export interface LayoutTimeout { readonly ms: number; readonly message: string }
export interface LayoutSnapshot {
  layout: WorkspaceLayout;
  revision: number;
  phase: 'loading' | 'ready' | 'saving' | 'error' | 'conflict';
  error?: string;
  loaded: boolean;
  dirty: boolean;
}

/** 写请求串行化；后续编辑不被迟到回执覆盖，失败／冲突时完整保留草稿。 */
export class WorkspaceLayoutStore {
  private state: LayoutSnapshot;
  private readonly listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private saving?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private savedVersion = 0;
  /** `normalize` 在读入与每次改动后修正布局（旧形状迁移、与分组对齐）；读入时修正出了差别就记一次改动，随后保存。 */
  constructor(private readonly transport: LayoutTransport, private readonly initial: WorkspaceLayout, private readonly normalize: (layout: WorkspaceLayout) => WorkspaceLayout = (layout) => layout,
    private readonly timeout: LayoutTimeout = { ms: LAYOUT_REQUEST_TIMEOUT_MS, message: `布局读写 ${LAYOUT_REQUEST_TIMEOUT_MS / 1000} 秒没有回应，已取消` }) {
    this.state = { layout: initial, revision: 0, phase: 'loading', loaded: false, dirty: false };
  }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly load = (): Promise<void> => {
    if (this.loading) return this.loading;
    if (this.state.loaded && (this.savedVersion !== this.version || this.saving)) return Promise.resolve();
    const version = this.version;
    this.loading = this.timed((signal) => this.transport.get(signal)).then((remote) => {
      if (version !== this.version) return;
      this.adopt(remote.layout ?? this.state.layout, remote.revision);
    }).catch((error: unknown) => this.patch({ phase: 'error', error: errorMessage(error) })).finally(() => { this.loading = undefined; });
    return this.loading;
  };
  readonly update = (update: (layout: WorkspaceLayout) => WorkspaceLayout): void => {
    if (!this.state.loaded || this.state.phase === 'loading') return;
    const changed = update(this.state.layout), layout = changed === this.state.layout ? changed : this.normalize(changed);
    if (layout === this.state.layout || JSON.stringify(layout) === JSON.stringify(this.state.layout)) return;
    this.version++;
    this.patch({ layout });
    if (this.state.phase === 'ready') this.schedule();
  };
  /** 用户主动选择覆盖为最新布局；不会由轮询或焦点变化丢掉草稿。 */
  readonly useRemote = async (): Promise<void> => {
    if (this.saving || this.loading) return;
    this.clearTimer();
    this.patch({ phase: 'loading' });
    try {
      const remote = await this.timed((signal) => this.transport.get(signal));
      this.savedVersion = this.version;
      this.adopt(remote.layout ?? this.initial, remote.revision);
    } catch (error) { this.patch({ phase: 'error', error: errorMessage(error) }); }
  };
  private adopt(layout: WorkspaceLayout, revision: number): void {
    const normalized = this.normalize(layout);
    if (normalized !== layout) this.version++;
    this.patch({ layout: normalized, revision, phase: 'ready', loaded: true, error: undefined });
    if (normalized !== layout) this.schedule();
  }
  /** 错误之后先查实际 revision；回执丢失但保存已成功时直接对账，不重复写。 */
  readonly reapply = async (): Promise<void> => {
    if (this.saving || this.loading) return;
    this.clearTimer();
    this.patch({ phase: 'saving' });
    try {
      const remote = await this.timed((signal) => this.transport.get(signal));
      if (JSON.stringify(remote.layout) === JSON.stringify(this.state.layout)) {
        this.savedVersion = this.version;
        this.patch({ revision: remote.revision, phase: 'ready', error: undefined });
      } else {
        this.patch({ revision: remote.revision, phase: 'ready', error: undefined });
        await this.flush();
      }
    } catch (error) { this.patch({ phase: 'error', error: errorMessage(error) }); }
  };
  readonly flush = (): Promise<void> => {
    this.clearTimer();
    if (this.saving) return this.saving;
    if (this.version === this.savedVersion || !this.state.loaded || this.state.phase === 'error' || this.state.phase === 'conflict') return Promise.resolve();
    const version = this.version, layout = this.state.layout;
    this.patch({ phase: 'saving', error: undefined });
    const expectedRevision = this.state.revision;
    this.saving = this.timed((signal) => this.transport.save({ expectedRevision, layout }, signal)).then((remote) => {
      this.savedVersion = version;
      this.patch({ revision: remote.revision, phase: 'ready' });
    }).catch((error: unknown) => this.patch({ phase: isApiClientError(error) && error.kind === 'conflict' ? 'conflict' : 'error', error: errorMessage(error) })).finally(() => {
      this.saving = undefined;
      if (this.version !== this.savedVersion && this.state.phase === 'ready') this.schedule();
    });
    return this.saving;
  };
  /** 先按超时失败、再取消请求：挂住的请求不再占着串行的写队列，迟到的回执也不会覆盖之后的状态。 */
  private timed<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(this.timeout.message)); controller.abort(); }, this.timeout.ms); });
    return Promise.race([call(controller.signal), expired]).finally(() => clearTimeout(timer));
  }
  private schedule(): void { this.clearTimer(); this.timer = setTimeout(() => void this.flush(), 300); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private patch(change: Partial<LayoutSnapshot>): void { this.state = { ...this.state, ...change, dirty: this.version !== this.savedVersion }; for (const listener of this.listeners) listener(); }
}

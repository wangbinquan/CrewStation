import type { SaveWorkspaceLayoutRequest, WorkspaceLayout, WorkspaceLayoutDto } from '@crewstation/contracts';
import { isApiClientError } from '@crewstation/api-client';
import { errorMessage } from '../../../../shared/api/useApi';

export interface LayoutTransport {
  get(): Promise<WorkspaceLayoutDto>;
  save(input: SaveWorkspaceLayoutRequest): Promise<WorkspaceLayoutDto>;
}
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
  constructor(private readonly transport: LayoutTransport, private readonly initial: WorkspaceLayout) {
    this.state = { layout: initial, revision: 0, phase: 'loading', loaded: false, dirty: false };
  }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly load = (): Promise<void> => {
    if (this.loading) return this.loading;
    if (this.state.loaded && (this.savedVersion !== this.version || this.saving)) return Promise.resolve();
    const version = this.version;
    this.loading = this.transport.get().then((remote) => {
      if (version !== this.version) return;
      this.patch({ layout: remote.layout ?? this.state.layout, revision: remote.revision, phase: 'ready', loaded: true, error: undefined });
    }).catch((error: unknown) => this.patch({ phase: 'error', error: errorMessage(error) })).finally(() => { this.loading = undefined; });
    return this.loading;
  };
  readonly update = (update: (layout: WorkspaceLayout) => WorkspaceLayout): void => {
    if (!this.state.loaded || this.state.phase === 'loading') return;
    const layout = update(this.state.layout);
    if (layout === this.state.layout) return;
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
      const remote = await this.transport.get();
      this.savedVersion = this.version;
      this.patch({ layout: remote.layout ?? this.initial, revision: remote.revision, phase: 'ready', loaded: true, error: undefined });
    } catch (error) { this.patch({ phase: 'error', error: errorMessage(error) }); }
  };
  /** 错误之后先查实际 revision；回执丢失但保存已成功时直接对账，不重复写。 */
  readonly reapply = async (): Promise<void> => {
    if (this.saving || this.loading) return;
    this.clearTimer();
    this.patch({ phase: 'saving' });
    try {
      const remote = await this.transport.get();
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
    this.saving = this.transport.save({ expectedRevision: this.state.revision, layout }).then((remote) => {
      this.savedVersion = version;
      this.patch({ revision: remote.revision, phase: 'ready' });
    }).catch((error: unknown) => this.patch({ phase: isApiClientError(error) && error.kind === 'conflict' ? 'conflict' : 'error', error: errorMessage(error) })).finally(() => {
      this.saving = undefined;
      if (this.version !== this.savedVersion && this.state.phase === 'ready') this.schedule();
    });
    return this.saving;
  };
  private schedule(): void { this.clearTimer(); this.timer = setTimeout(() => void this.flush(), 300); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private patch(change: Partial<LayoutSnapshot>): void { this.state = { ...this.state, ...change, dirty: this.version !== this.savedVersion }; for (const listener of this.listeners) listener(); }
}

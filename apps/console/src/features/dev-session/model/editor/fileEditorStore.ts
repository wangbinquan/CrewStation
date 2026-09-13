import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { isVersionConflict, streamErrorMessage } from '../runnerErrors';
import { asReadFileResult, asWriteFileResult } from '../runnerResults';
import { StreamCommandError } from '../streamCommandQueue';

export interface EditorFile {
  readonly path: string;
  /** readFile 返回的内容 sha256，写回时作 expectedVersion。 */
  readonly version: string;
  /** 从磁盘重新读入时变化；保存成功不重置文档与光标。 */
  readonly revision: number;
}
export type EditorDiscardAction = { readonly type: 'open'; readonly path: string } | { readonly type: 'reload' | 'close' };
export interface FileEditorState {
  readonly file: EditorFile | undefined;
  readonly draft: string;
  readonly baseline: string;
  readonly operation: 'read' | 'write' | undefined;
  readonly conflict: boolean;
  readonly error: string | undefined;
  readonly pendingAction: EditorDiscardAction | undefined;
}
const EMPTY: FileEditorState = { file: undefined, draft: '', baseline: '', operation: undefined, conflict: false, error: undefined, pendingAction: undefined };

/** 一个任务通道的单文件草稿。请求与快照同步登记，异步回执只能更新原请求。 */
export class FileEditorStore {
  private state = EMPTY;
  private readonly listeners = new Set<() => void>();
  private ticket = 0;
  private revision = 0;
  private active = true;
  constructor(private readonly channel: TaskStreamChannel) {}
  getSnapshot = (): FileEditorState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  activate = (): void => { this.active = true; };
  deactivate = (): void => { this.active = false; this.ticket += 1; this.update({ operation: undefined, pendingAction: undefined }); };
  private update(patch: Partial<FileEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(ticket: number): boolean { return this.active && this.ticket === ticket; }

  change = (draft: string): void => {
    if (!this.active || !this.state.file || draft === this.state.draft) return;
    // 读另一个文件期间继续输入，新的输入优先；迟到的读取不能覆盖它。
    if (this.state.operation === 'read') { this.ticket += 1; this.update({ operation: undefined }); }
    this.update({ draft });
  };
  openFile = (path: string): void => { if (path !== this.state.file?.path) this.request({ type: 'open', path }); };
  /** 页面导航已经取得放弃确认，避免进入新地址后再问一遍。读失败仍保留旧输入。 */
  discardAndOpen = (path: string): void => {
    if (!this.active || this.state.operation === 'write') return;
    this.update({ pendingAction: undefined }); this.perform({ type: 'open', path });
  };
  reload = (): void => { if (this.state.file) this.request({ type: 'reload' }); };
  close = (): void => { this.request({ type: 'close' }); };
  cancelDiscard = (): void => { this.update({ pendingAction: undefined }); };
  dismissConflict = (): void => { this.update({ conflict: false }); };
  confirmDiscard = (): void => {
    const action = this.state.pendingAction;
    if (!action || !this.active || this.state.operation === 'write') return;
    this.update({ pendingAction: undefined }); this.perform(action);
  };
  private request(action: EditorDiscardAction): void {
    if (!this.active || this.state.operation === 'write' || this.state.pendingAction) return;
    if (this.state.draft !== this.state.baseline) this.update({ pendingAction: action });
    else this.perform(action);
  }
  private perform(action: EditorDiscardAction): void {
    if (action.type === 'close') { this.ticket += 1; this.update(EMPTY); }
    else {
      const path = action.type === 'open' ? action.path : this.state.file?.path;
      if (path) void this.read(path);
    }
  }
  private async read(path: string): Promise<void> {
    const ticket = ++this.ticket;
    this.update({ operation: 'read', error: undefined });
    try {
      const result = asReadFileResult(await this.channel.send({ type: 'readFile', path }));
      if (!this.current(ticket)) return;
      if (!result.version) throw new StreamCommandError('malformed_result', 'readFile 未返回有效内容版本，未替换编辑器草稿');
      this.update({ file: { path: result.path || path, version: result.version, revision: ++this.revision }, draft: result.content, baseline: result.content, conflict: false });
    } catch (cause) { if (this.current(ticket)) this.update({ error: streamErrorMessage(cause) }); }
    finally { if (this.current(ticket)) this.update({ operation: undefined }); }
  }
  save = (): void => {
    const { file, draft, baseline, operation, pendingAction } = this.state;
    if (!this.active || !file || draft === baseline || operation || pendingAction) return;
    void this.write(file, draft);
  };
  private async write(file: EditorFile, draft: string): Promise<void> {
    const ticket = ++this.ticket;
    this.update({ operation: 'write', error: undefined, conflict: false });
    try {
      const result = asWriteFileResult(await this.channel.send({ type: 'writeFile', path: file.path, content: draft, expectedVersion: file.version }));
      if (!this.current(ticket)) return;
      if (!result.version || result.path !== file.path) throw new StreamCommandError('malformed_result', 'writeFile 回执与当前文件不一致，保存结果未确认');
      this.update({ file: { ...file, version: result.version }, baseline: draft });
    } catch (cause) {
      if (this.current(ticket)) this.update(isVersionConflict(cause) ? { conflict: true } : { error: streamErrorMessage(cause) });
    } finally { if (this.current(ticket)) this.update({ operation: undefined }); }
  }
}

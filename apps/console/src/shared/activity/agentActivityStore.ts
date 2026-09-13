import type { AgentActivityPage, NativeTerminalList, ReadAgentActivityRequest } from '@crewstation/contracts';
import { AgentActivityPageSchema, NativeTerminalListSchema } from '@crewstation/contracts';
import { isApiClientError } from '@crewstation/api-client';

export interface ActivityTask {
  taskId: string; projectId: string; name: string; page?: AgentActivityPage; terminals?: NativeTerminalList;
  space?: 'workbench' | 'admin';
  error?: string; stale: boolean; loading: boolean; older?: AgentActivityPage; olderBefore?: number; olderLoading?: boolean;
}
export interface ActivitySnapshot { tasks: ActivityTask[]; notice: { id: number; count: number } | null; limited: boolean }
export interface ActivitySource {
  page(taskId: string, before?: number): Promise<AgentActivityPage>;
  terminals(taskId: string): Promise<NativeTerminalList>;
  read(taskId: string, input: ReadAgentActivityRequest): Promise<{ throughSeq: number }>;
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('activity.timeout')), 12000); })]); }
  finally { clearTimeout(timer!); }
}

/** 只保存当前身份的有界关注清单；离开页签不移除，退出 Provider 才停止轮询。 */
export class AgentActivityStore {
  private snapshot: ActivitySnapshot = { tasks: [], notice: null, limited: false };
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private seen = new Map<string, Set<string>>();
  private tokens = new Map<string, symbol>();
  private noticeId = 0;
  constructor(private readonly source: ActivitySource) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(tasks = this.snapshot.tasks) { this.snapshot = { ...this.snapshot, tasks }; for (const listener of this.listeners) listener(); }
  private update(taskId: string, change: Partial<ActivityTask>) { this.emit(this.snapshot.tasks.map((task) => task.taskId === taskId ? { ...task, ...change } : task)); }

  register(taskId: string, projectId: string, name: string, space: 'workbench' | 'admin' = 'workbench'): void {
    const previous = this.snapshot.tasks.find((task) => task.taskId === taskId);
    if (previous) { if (previous.name !== name || previous.space !== space) this.update(taskId, { name, space }); return; }
    if (this.snapshot.tasks.length >= 16) { this.snapshot = { ...this.snapshot, limited: true }; this.emit(); return; }
    this.tokens.set(taskId, Symbol(taskId));
    this.emit([...this.snapshot.tasks, { taskId, projectId, name, space, stale: true, loading: true }]);
    void this.refresh(taskId);
  }

  refresh(taskId: string): Promise<void> {
    const previous = this.pending.get(taskId);
    if (previous) return previous;
    const task = this.snapshot.tasks.find((item) => item.taskId === taskId);
    if (!task) return Promise.resolve();
    const operation = this.load(task).finally(() => { if (this.pending.get(taskId) === operation) this.pending.delete(taskId); });
    this.pending.set(taskId, operation);
    return operation;
  }

  private async load(task: ActivityTask): Promise<void> {
    const token = this.tokens.get(task.taskId);
    const [activity, terminals, older] = await Promise.allSettled([bounded(this.source.page(task.taskId)), bounded(this.source.terminals(task.taskId)), task.older ? bounded(this.source.page(task.taskId, task.olderBefore)) : Promise.resolve(undefined)]);
    if (this.tokens.get(task.taskId) !== token) return;
    const rejected = [activity, terminals, older].find((result) => result.status === 'rejected' && isApiClientError(result.reason) && [401, 403, 404].includes(result.reason.status));
    if (rejected) { this.forget(task.taskId); return; }
    try {
      const roster = terminals.status === 'fulfilled' ? NativeTerminalListSchema.parse(terminals.value) : undefined;
      if (activity.status === 'rejected') { this.update(task.taskId, { ...(roster ? { terminals: roster } : {}), loading: false, stale: true, error: activity.reason instanceof Error ? activity.reason.message : String(activity.reason) }); return; }
      const page = AgentActivityPageSchema.parse(activity.value);
      if (page.taskId !== task.taskId || page.projectId !== task.projectId) throw new Error('activity.identityMismatch');
      const old = older.status === 'fulfilled' && older.value ? AgentActivityPageSchema.parse(older.value) : undefined;
      if (old && (old.taskId !== task.taskId || old.projectId !== task.projectId)) throw new Error('activity.identityMismatch');
      this.announce(task.taskId, page, roster);
      const samePage = task.older && this.snapshot.tasks.find((item) => item.taskId === task.taskId)?.olderBefore === task.olderBefore;
      this.update(task.taskId, { page, ...(roster ? { terminals: roster } : {}), ...(samePage && old ? { older: old } : {}), loading: false, stale: older.status === 'rejected', error: older.status === 'rejected' ? 'activity.olderUnavailable' : undefined });
    } catch (error) { this.update(task.taskId, { loading: false, stale: true, error: error instanceof Error ? error.message : String(error) }); }
  }

  private announce(taskId: string, page: AgentActivityPage, roster?: NativeTerminalList): void {
    const seen = this.seen.get(taskId) ?? new Set<string>();
    const keys = [...page.items.filter((item) => item.unread).map((item) => item.eventId),
      ...page.states.flatMap((state) => !state.processEnded && state.source === 'ready' ? state.pending.filter((request) => request.unread).map((request) => request.eventId) : []),
      ...(roster?.items.filter((item) => item.lifecycle === 'failed').map((item) => `failed:${item.agentId}:${item.revision}`) ?? [])];
    const fresh = page.sync === 'ready' ? keys.filter((key) => !seen.has(key)) : [];
    for (const key of fresh) seen.add(key);
    while (seen.size > 4096) seen.delete(seen.values().next().value!);
    this.seen.set(taskId, seen);
    if (fresh.length) this.snapshot = { ...this.snapshot, notice: { id: ++this.noticeId, count: fresh.length } };
  }

  async read(taskId: string, input: ReadAgentActivityRequest): Promise<void> {
    const token = this.tokens.get(taskId);
    try { await bounded(this.source.read(taskId, input)); }
    catch (error) { if (this.tokens.get(taskId) === token && isApiClientError(error) && [401, 403, 404].includes(error.status)) this.forget(taskId); throw error; }
    // 先收完可能早于已读写入发出的查询，再重新获取本人状态。
    await this.pending.get(taskId);
    if (this.tokens.get(taskId) !== token) return;
    const task = this.snapshot.tasks.find((item) => item.taskId === taskId);
    const mark = (page?: AgentActivityPage) => page ? { ...page, items: page.items.filter((item) => item.agentId !== input.agentId || item.turnId !== input.turnId || item.seq > input.throughSeq), states: page.states.map((state) => ({ ...state, pending: state.pending.map((request) => state.agentId === input.agentId && request.turnId === input.turnId && request.seq <= input.throughSeq ? { ...request, unread: false } : request) })) } : undefined;
    if (task) this.update(taskId, { page: mark(task.page), older: mark(task.older) });
    await this.refresh(taskId);
  }

  async older(taskId: string, before?: number): Promise<void> {
    const task = this.snapshot.tasks.find((item) => item.taskId === taskId);
    if (!task || task.olderLoading) return;
    const token = this.tokens.get(taskId);
    this.update(taskId, { olderLoading: true });
    try {
      const page = AgentActivityPageSchema.parse(await bounded(this.source.page(taskId, before)));
      if (page.taskId !== taskId || page.projectId !== task.projectId) throw new Error('activity.identityMismatch');
      if (this.tokens.get(taskId) === token) this.update(taskId, { older: page, olderBefore: before, olderLoading: false, error: undefined });
    } catch (error) {
      if (this.tokens.get(taskId) !== token) return;
      if (isApiClientError(error) && [401, 403, 404].includes(error.status)) this.forget(taskId);
      else this.update(taskId, { olderLoading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  resetOlder(taskId: string) { this.update(taskId, { older: undefined, olderBefore: undefined }); }
  dismissNotice(id: number) { if (this.snapshot.notice?.id === id) { this.snapshot = { ...this.snapshot, notice: null }; this.emit(); } }
  forget(taskId: string) { this.tokens.delete(taskId); this.pending.delete(taskId); this.seen.delete(taskId); this.emit(this.snapshot.tasks.filter((task) => task.taskId !== taskId)); }
  dispose() { this.tokens.clear(); this.pending.clear(); this.seen.clear(); this.snapshot = { tasks: [], notice: null, limited: false }; }
}

import type { Actor, AgentActivityPage, AgentActivityQuery, NativeTerminalRoster, ReadAgentActivityRequest, TaskId } from '@crewstation/contracts';
import { AgentActivityQuerySchema, ReadAgentActivityRequestSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import type { NativeActivityRepository } from '../ports/nativeActivity';
import type { NativeTerminalRepository, NativeTerminalStart } from '../ports/nativeTerminals';
import { initialNativeActivity } from '../domain/nativeActivityProjection';
import type { DevSessionUseCaseDeps } from './dependencies';
import { nativeEnvironment } from './nativeTerminalAccess';

export async function boundedNativeRead<T>(promise: Promise<T>, timeoutMs = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Activity source timeout')), timeoutMs); })]); }
  finally { clearTimeout(timer!); }
}
/**
 * 名册顺带的原生活动页：同一任务、同一人在 ttl 内复用上一次，进行中的也共用；拒绝（权限错误）不留。RFC-022 让启动中的
 * 名册每秒读一次，而原生活动要逐个 CLI 问 Runner、同步事件、开快照读事务，超时放弃后仍在后台跑；跟着每秒做，Runner 慢时
 * 放弃的查询会在后台叠起来。这只是减负：2026-09-23 曾以为它是 I16（连接池错位）的诱因，上线后照样复发，I16 由 RFC-023 换驱动处理。
 * 已读状态按人区分，所以按人缓存；页面上的活动以单独的活动查询为准，名册里的只是兜底。
 */
export function rosterActivity(read: (actor: Actor, taskId: TaskId) => Promise<AgentActivityPage | undefined>, clock: { now(): Date }, ttlMs = 5000) {
  const cache = new Map<string, { at: number; page: Promise<AgentActivityPage | undefined> }>();
  return (actor: Actor, taskId: TaskId): Promise<AgentActivityPage | undefined> => {
    const key = `${taskId}:${actor.userId}`, now = clock.now().getTime(), hit = cache.get(key);
    if (hit && now - hit.at < ttlMs) return hit.page;
    const entry = { at: now, page: read(actor, taskId) };
    entry.page.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > 1024) cache.delete(cache.keys().next().value!);
    return entry.page;
  };
}

type Sync = AgentActivityPage['sync'];
type Connection = { state: AgentActivityPage['connection']; roster?: NativeTerminalRoster; ended?: boolean };

class NativeActivityQueries {
  private readonly pending = new Map<TaskId, Promise<Map<TaskId, Sync>>>();
  constructor(private readonly deps: DevSessionUseCaseDeps, private readonly repository: NativeActivityRepository, private readonly terminals?: Pick<NativeTerminalRepository, 'list'>) {}
  private async synchronizeSource(taskId: TaskId, sourceId: TaskId, attempt: { active: boolean }): Promise<Sync> {
    try {
      let cursor = await this.repository.cursor(taskId, sourceId);
      for (let page = 0; page < 4; page++) {
        if (!attempt.active) return 'unavailable';
        const events = await boundedNativeRead(this.deps.runner.listEvents(sourceId, { sinceSeq: cursor, kinds: ['nativeActivity', 'nativeTerminal'], limit: 500 }));
        if (!attempt.active) return 'unavailable';
        cursor = await this.repository.apply(taskId, cursor, events, sourceId);
        if (events.length < 500) return 'ready';
      }
      return 'catching-up';
    } catch { this.deps.logger.warn('native activity synchronization unavailable', { taskId, sourceId }); return 'unavailable'; }
  }
  private sync(taskId: TaskId, starts: NativeTerminalStart[]) {
    let operation = this.pending.get(taskId);
    if (operation) return operation;
    if (this.pending.size >= 256) return Promise.resolve(new Map<TaskId, Sync>([[taskId, 'unavailable']]));
    const attempt = { active: true };
    const run = async () => {
      const completed = new Set(await this.repository.completedSources(taskId));
      if (!attempt.active) return new Map<TaskId, Sync>([[taskId, 'unavailable']]);
      const sources = [taskId, ...new Set(starts.flatMap((start) => start.execution ? [start.execution.taskId] : []))];
      const results = new Map<TaskId, Sync>();
      // 完成的子来源只读持久投影；多个活跃来源使用各自游标，避免跨 Runner 跳过序号。
      for (let i = 0; i < sources.length; i += 8) await Promise.all(sources.slice(i, i + 8).map(async (source) => {
        const status = completed.has(source) ? 'ready' : await this.synchronizeSource(taskId, source, attempt);
        results.set(source, status);
        if (attempt.active && !completed.has(source) && source !== taskId && status === 'ready' && starts.find((start) => start.execution?.taskId === source)?.execution?.finalized) await this.repository.completeSource(taskId, source);
      }));
      return results;
    };
    // 补齐先到期，留出读取持久历史的时间，并在名册总期限前释放 pending。
    operation = boundedNativeRead(run(), 2000).catch(() => new Map<TaskId, Sync>([[taskId, 'unavailable']])).finally(() => { attempt.active = false; this.pending.delete(taskId); });
    this.pending.set(taskId, operation); return operation;
  }
  private async connection(taskId: TaskId, connected: boolean): Promise<Connection> {
    if (!connected) return { state: 'disconnected' };
    try { return { state: 'connected', roster: RunnerResultPayloads.listAgentTerminals.parse(await boundedNativeRead(this.deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'listAgentTerminals' }))) }; }
    catch { return { state: 'unknown' }; }
  }
  private async connections(taskId: TaskId, connected: boolean, starts: NativeTerminalStart[]) {
    const rows = await Promise.all([this.connection(taskId, connected).then((value) => [taskId, value] as const), ...starts.filter((start) => start.execution).map(async (start) => {
      const execution = start.execution!;
      if (execution.finalized) return [execution.taskId, { state: 'disconnected', ended: true }] as const;
      const env = await this.deps.environments.getEnvironment(execution.taskId);
      const result = await this.connection(execution.taskId, env?.connected ?? false);
      return [execution.taskId, { ...result, ended: env?.native?.state === 'cleaning' || env?.native?.state === 'finished' }] as const;
    })]);
    return new Map<TaskId, Connection>(rows);
  }
  async get(actor: Actor, taskId: TaskId, input: AgentActivityQuery): Promise<AgentActivityPage> {
    const query = AgentActivityQuerySchema.parse(input), env = await nativeEnvironment(this.deps, actor, taskId, 'view');
    const starts = await this.terminals?.list(taskId) ?? [];
    const [statuses, connections] = await Promise.all([this.sync(taskId, starts), this.connections(taskId, env.connected, starts)]);
    const result = await boundedNativeRead(this.repository.read(taskId, actor.userId, query));
    const projected = [...result.states, ...starts.filter((start) => !result.states.some((state) => state.agentId === start.record.agentId)).map((start) => initialNativeActivity(start.record).state)];
    const states = projected.map((state) => {
      const start = starts.find((item) => item.record.agentId === state.agentId), sourceId = start?.execution?.taskId ?? taskId;
      const connected = connections.get(sourceId), record = connected?.roster?.terminals.find((item) => item.agentId === state.agentId && item.terminalId === state.terminalId);
      const ended = connected?.ended || start?.record.lifecycle === 'ended' || start?.record.lifecycle === 'failed' || connected?.roster && (connected.roster.runnerId !== state.runnerId || record?.lifecycle === 'ended' || record?.lifecycle === 'failed');
      return { ...state, ...(ended ? { processEnded: true, pending: [] } : {}), connection: connected?.state ?? 'unknown', sync: statuses.get(sourceId) ?? 'unavailable' };
    });
    const items = result.items.map((item) => item.kind === 'request-opened' && !states.some((state) => state.agentId === item.agentId && state.pending.some((request) => request.id === item.request?.id && request.turnId === item.turnId)) ? { ...item, unread: false } : item);
    await this.deps.authorizer.authorize(actor, env.projectId, 'view');
    const statusesList = [...statuses.values()], sync: Sync = statusesList.includes('unavailable') ? 'unavailable' : statusesList.includes('catching-up') ? 'catching-up' : 'ready';
    return { ...result, items, states, taskId, projectId: env.projectId, sync, connection: connections.get(taskId)?.state ?? 'unknown', checkedAt: this.deps.clock.now().toISOString() };
  }
  async read(actor: Actor, taskId: TaskId, input: ReadAgentActivityRequest): Promise<{ throughSeq: number }> {
    await nativeEnvironment(this.deps, actor, taskId, 'view');
    return { throughSeq: await this.repository.markRead(taskId, actor.userId, ReadAgentActivityRequestSchema.parse(input)) };
  }
}

/** 按需补齐所有执行来源，断线仍可读历史；每位用户单独读取和更新已读位置。 */
export function nativeActivityUseCases(deps: DevSessionUseCaseDeps, repository: NativeActivityRepository, terminals?: Pick<NativeTerminalRepository, 'list'>) {
  const cases = new NativeActivityQueries(deps, repository, terminals);
  return { getAgentActivity: cases.get.bind(cases), readAgentActivity: cases.read.bind(cases) };
}

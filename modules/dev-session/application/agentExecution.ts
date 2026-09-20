import type { ServiceId, TaskId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import type { AgentStart, AgentStartRepository } from '../ports/agentStarts';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionUseCaseDeps } from './dependencies';
import { profileLaunchFields } from './profileLaunch';

/** 定性失败：重试也不会成功，记录结束并把原因给用户；其余（网络、Runner 未就绪）留给后台接续。 */
const DEFINITIVE = new Set(['precondition', 'validation', 'quota_exceeded', 'not_found', 'conflict']);
const definitive = (error: unknown): error is Error => isPlatformError(error) && DEFINITIVE.has(error.kind);
const TERMINAL_EVENTS = new Set(['completed', 'error', 'cancelled']);
const gone = (env: EnvironmentView | undefined) => !env || ['cleaning', 'finished'].includes(env.native?.state ?? '') || ['released', 'failed'].includes(env.state);

/**
 * headless Agent 的执行环境生命周期（RFC-006 §5.3）：受理即登记执行环境并占额；子 Runner 连上后派发 startAgent；
 * 看到终态事件、启动前步骤失败或执行环境失败即结束，并把回收交给 task-runtime。每个 Agent 跨实例串行，结束后绝不重启。
 */
export class AgentExecutionLifecycle {
  private readonly active = new Map<string, Promise<void>>();
  /** 处理中又来了信号（子 Runner 就绪、事件、取消）：当前一轮结束后再跑一轮，不丢信号。 */
  private readonly rerun = new Set<string>();
  private after: string | undefined;
  private sweeping = false;
  constructor(private readonly deps: DevSessionUseCaseDeps, private readonly repo: AgentStartRepository) {}

  /** 同步受理：额度满、父会话断开等定性原因直接抛给调用方，记录同时结束。 */
  async admit(start: AgentStart): Promise<EnvironmentView> {
    try {
      return await this.deps.environments.createNativeExecution({
        id: start.execution.taskId, parentTaskId: start.taskId, purpose: 'agent', createdBy: start.createdBy, agentId: start.agentId, runnerId: start.execution.runnerId,
        fingerprint: `${start.agentId}:${start.profile.profileId}@${start.profile.revision}`, ...(start.execution.taskProfile ? { profile: start.execution.taskProfile } : {}),
        image: start.execution.image, computeProfile: { profileId: start.profile.profileId, revision: start.profile.revision },
      });
    } catch (error) {
      if (definitive(error)) await this.end(start, { failure: error.message });
      throw error;
    }
  }

  async end(start: AgentStart, outcome: { failure?: string; cancelled?: boolean }): Promise<AgentStart> {
    if (start.state === 'ended') return start;
    const ended: AgentStart = { ...start, state: 'ended', ...(outcome.failure ? { failure: outcome.failure } : {}), ...(outcome.cancelled ? { cancelled: true } : {}), endedAt: this.deps.clock.now().toISOString() };
    await this.repo.update(ended);
    return ended;
  }

  private async send(start: AgentStart, env: EnvironmentView): Promise<void> {
    // 连接头在 spawn 时写死、事后改不了，所以派发时现签一枚（Design §5.9）；MCP 与数据身份仍是父开发会话。
    const credential = await this.deps.credentials.issueDevSessionToken({ taskId: start.taskId, projectId: env.projectId, serviceId: env.serviceId as ServiceId, userId: start.createdBy });
    const launch = await profileLaunchFields(this.deps, start.profile, start.agentId);
    await this.deps.runner.sendCommand(env.id, {
      id: `start-${start.agentId}`, type: 'startAgent', agentId: start.agentId, ...launch, permission: start.permission, mode: 'interactive',
      ...(start.request.cwd ? { cwd: start.request.cwd } : {}), initialPrompt: start.request.prompt, ...(start.request.resumeSessionId ? { resumeSessionId: start.request.resumeSessionId } : {}),
      mcp: this.deps.settings.mcp.map((m) => ({ name: m.name, url: m.url, headers: { [IDENTITY_HEADERS.devSessionToken]: credential.token } })), env: {},
    });
    await this.repo.update({ ...start, state: 'dispatched', dispatchedAt: this.deps.clock.now().toISOString() });
    await this.deps.environments.touch(start.taskId);
  }

  /** 只读新事件：终态事件或启动前步骤失败即结束；结束原因取 Agent 自己的错误文案。 */
  private async observe(start: AgentStart, env: EnvironmentView): Promise<AgentStart> {
    const events = await this.deps.runner.listEvents(env.id, { sinceSeq: start.cursor, kinds: ['agent', 'beforeStart'], agentId: start.agentId, limit: 500 });
    let cursor = start.cursor, outcome: { failure?: string; cancelled?: boolean } | undefined;
    for (const stored of events) {
      cursor = stored.seq;
      const event = stored.event;
      if (event.kind === 'agent' && event.event.agentId === start.agentId && TERMINAL_EVENTS.has(event.event.type)) {
        outcome = event.event.type === 'error' ? { failure: event.event.error?.message ?? 'Agent 报错' } : event.event.type === 'cancelled' ? { cancelled: true } : {};
      }
      if (event.kind === 'beforeStart' && event.execution.agentId === start.agentId && ['failed', 'cancelled'].includes(event.execution.state)) outcome ??= { failure: event.execution.error?.message ?? '启动前步骤失败' };
    }
    const moved = cursor === start.cursor ? start : { ...start, cursor };
    if (moved !== start) await this.repo.update(moved);
    return outcome ? this.end(moved, outcome) : moved;
  }

  private async tick(agentId: string): Promise<void> {
    let start = await this.repo.get(agentId);
    if (!start || start.finalized) return;
    if (start.state === 'pending' && start.execution.previousTaskId) { const old = await this.deps.environments.getEnvironment(start.execution.previousTaskId); if (old && old.native?.state !== 'finished') return; }
    let env = await this.deps.environments.getEnvironment(start.execution.taskId);
    if (start.state === 'pending' && !env) env = await this.admit(start).catch((error: unknown) => { if (definitive(error)) return undefined; throw error; });
    start = (await this.repo.get(agentId))!;
    if (start.state === 'pending' && env?.connected && env.native?.state === 'running') {
      try { await this.send(start, env); }
      catch (error) { if (definitive(error)) await this.end(start, { failure: error.message }); else throw error; }
      start = (await this.repo.get(agentId))!;
    }
    if (start.state === 'dispatched' && env && !gone(env)) start = await this.observe(start, env);
    if (start.state !== 'ended' && gone(env) && (start.state === 'dispatched' || env)) start = await this.end(start, { failure: env?.native?.failureReason ?? env?.message ?? '此 Agent 的执行环境已结束' });
    if (start.state !== 'ended') return;
    if (env && !gone(env)) await this.deps.environments.releaseEnvironment(env.id, 'user');
    await this.repo.update({ ...start, finalized: true });
  }

  dispatch(agentId: string): Promise<void> {
    const current = this.active.get(agentId);
    if (current) { this.rerun.add(agentId); return current; }
    // 每个处理占一条带咨询锁的事务连接：与「＋ CLI」的派发一样每进程最多两项，避免占满连接池。
    if (this.active.size >= 2) return Promise.resolve();
    const operation = (async () => {
      do {
        this.rerun.delete(agentId);
        await this.repo.withLock(agentId, () => this.tick(agentId)).catch((error: unknown) => { this.deps.logger.warn('agent execution will retry', { agentId, error: error instanceof Error ? error.message : String(error) }); });
      } while (this.rerun.has(agentId));
    })().finally(() => { this.active.delete(agentId); });
    this.active.set(agentId, operation); return operation;
  }

  async dispatchExecution(executionTaskId: TaskId): Promise<boolean> {
    const start = await this.repo.findByExecution(executionTaskId);
    if (!start) return false;
    await this.dispatch(start.agentId);
    return true;
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const starts = await this.repo.listUnfinalized(this.after, 32);
      this.after = starts.length === 32 ? starts.at(-1)!.agentId : undefined;
      for (let i = 0; i < starts.length; i += 2) await Promise.all(starts.slice(i, i + 2).map((start) => this.dispatch(start.agentId)));
    } finally { this.sweeping = false; }
  }
}

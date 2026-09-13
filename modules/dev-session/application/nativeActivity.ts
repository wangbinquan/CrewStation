import type { Actor, AgentActivityPage, AgentActivityQuery, NativeTerminalRoster, ReadAgentActivityRequest, TaskId } from '@crewstation/contracts';
import { AgentActivityQuerySchema, ReadAgentActivityRequestSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import type { NativeActivityRepository } from '../ports/nativeActivity';
import type { DevSessionUseCaseDeps } from './dependencies';
import { nativeEnvironment } from './nativeTerminalAccess';

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Activity source timeout')), 2500); })]); }
  finally { clearTimeout(timer!); }
}

/** 按需有界补齐持久源，断线仍可读历史；每位用户单独读取和更新已读位置。 */
export function nativeActivityUseCases(deps: DevSessionUseCaseDeps, repository: NativeActivityRepository) {
  const pending = new Map<TaskId, Promise<AgentActivityPage['sync']>>();
  const synchronize = async (taskId: TaskId): Promise<AgentActivityPage['sync']> => {
    try {
      let cursor = await repository.cursor(taskId);
      for (let page = 0; page < 4; page++) {
        const events = await bounded(deps.runner.listEvents(taskId, { sinceSeq: cursor, kinds: ['nativeActivity', 'nativeTerminal'], limit: 500 }));
        cursor = await repository.apply(taskId, cursor, events);
        if (events.length < 500) return 'ready';
      }
      return 'catching-up';
    } catch { deps.logger.warn('native activity synchronization unavailable', { taskId }); return 'unavailable'; }
  };
  const sync = (taskId: TaskId) => {
    let operation = pending.get(taskId);
    if (operation) return operation;
    if (pending.size >= 256) return Promise.resolve('unavailable' as const);
    operation = synchronize(taskId).finally(() => { if (pending.get(taskId) === operation) pending.delete(taskId); });
    pending.set(taskId, operation);
    return operation;
  };
  const connection = async (taskId: TaskId, connected: boolean): Promise<{ state: AgentActivityPage['connection']; roster?: NativeTerminalRoster }> => {
    if (!connected) return { state: 'disconnected' };
    // 注册表“仍有人持有连接”不能证明 Runner 仍响应；使用有界只读往返核对进程代次。
    try { return { state: 'connected', roster: RunnerResultPayloads.listAgentTerminals.parse(await bounded(deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'listAgentTerminals' }))) }; }
    catch { return { state: 'unknown' }; }
  };
  return {
    async getAgentActivity(actor: Actor, taskId: TaskId, input: AgentActivityQuery): Promise<AgentActivityPage> {
      const query = AgentActivityQuerySchema.parse(input);
      const env = await nativeEnvironment(deps, actor, taskId, 'view');
      const [status, connected] = await Promise.all([sync(taskId), connection(taskId, env.connected)]);
      const result = await repository.read(taskId, actor.userId, query);
      const states = result.states.map((state) => {
        const record = connected.roster?.terminals.find((item) => item.agentId === state.agentId && item.terminalId === state.terminalId);
        if (connected.roster && (connected.roster.runnerId !== state.runnerId || record?.lifecycle === 'ended' || record?.lifecycle === 'failed')) return { ...state, processEnded: true, pending: [] };
        return state;
      });
      const items = result.items.map((item) => item.kind === 'request-opened' && !states.some((state) => state.agentId === item.agentId && state.pending.some((request) => request.id === item.request?.id && request.turnId === item.turnId)) ? { ...item, unread: false } : item);
      await deps.authorizer.authorize(actor, env.projectId, 'view');
      return { ...result, items, states, taskId, projectId: env.projectId, sync: status, connection: connected.state, checkedAt: deps.clock.now().toISOString() };
    },
    async readAgentActivity(actor: Actor, taskId: TaskId, input: ReadAgentActivityRequest): Promise<{ throughSeq: number }> {
      await nativeEnvironment(deps, actor, taskId, 'view');
      return { throughSeq: await repository.markRead(taskId, actor.userId, ReadAgentActivityRequestSchema.parse(input)) };
    },
  };
}

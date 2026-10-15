import type { TaskId } from '@crewstation/contracts';
import type { DevelopmentCall } from '../ports/agentCalls';
import type { DevSessionUseCaseDeps } from './dependencies';

type CallInput = Omit<DevelopmentCall, 'projectId' | 'sessionLabel'>;

/** 派发前受理一次开发执行；展示名取开发会话受理时的分支。未装配记录端口时什么也不做。 */
export async function acceptDevelopmentCall(deps: Pick<DevSessionUseCaseDeps, 'calls' | 'environments'>, call: CallInput): Promise<void> {
  if (!deps.calls) return;
  const session = await deps.environments.getEnvironment(call.sessionId);
  if (!session) throw new Error('开发会话不存在，不能受理执行记录');
  await deps.calls.accept({ ...call, projectId: session.projectId, sessionLabel: session.branch ?? session.id });
}

/** 派发被定性拒绝：补写失败终态（未受理的执行没有可结束的记录）。 */
export async function failDevelopmentCall(deps: Pick<DevSessionUseCaseDeps, 'calls'>, runtimeTaskId: TaskId, agentId: string): Promise<void> {
  await deps.calls?.fail({ runtimeTaskId, agentId });
}

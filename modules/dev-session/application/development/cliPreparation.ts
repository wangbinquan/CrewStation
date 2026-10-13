import type { TaskId } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { NativeTerminalRepository } from '../../ports/nativeTerminals';
import type { Environments } from '../../ports/runtime';
import type { DevelopmentUsagePreparation } from '../../ports/developmentUsage';
/** The CLI has its own original admission. No synthetic headless AgentStart is created. */
export async function assertOriginalCliPreparation(input: DevelopmentUsagePreparation, terminals: Pick<NativeTerminalRepository, 'findExecution'> | undefined, environments: Pick<Environments, 'getEnvironment'>) {
  const i=input.intent, start=await terminals?.findExecution(i.identity.executionId as TaskId);
  if(!start?.execution?.observationIntent || start.execution.finalized || start.execution.stopRequested || start.record.lifecycle!=='starting') throw precondition('只能在原 CLI 首次派发前冻结用量配置');
  if(start.record.agentId!==i.identity.agentId || start.taskId!==i.identity.taskId || start.profile?.profileId!==i.profileId || start.profile.revision!==i.profileRevision || i.mode!=='cli' || i.initialPrompt!==null || i.resumeSessionId!==null || i.systemPrompt!==null || (start.input.cwd??null)!==i.cwd || JSON.stringify(start.execution.observationIntent)!==JSON.stringify(i)) throw conflict('CLI 数字意图不符合实际独立受理');
  const parent=await environments.getEnvironment(start.taskId);
  if(!parent || parent.native || parent.projectId!==i.identity.projectId || parent.serviceId!==input.context.serviceId || parent.traceId!==input.context.traceId || (parent.branch??null)!==input.context.branch) throw conflict('CLI 数字意图缺少原项目工作区证明');
}

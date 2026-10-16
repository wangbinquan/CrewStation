import type { TaskId } from '@crewstation/contracts';
import { PLATFORM_AGENT_PERMISSION } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { AgentStart, AgentStartRepository } from '../../ports/agentStarts';
import type { BotConversation, BotConversationRepository, BotExecution, BotOperation } from '../../ports/botConversations';
import type { DevSessionUseCaseDeps } from '../dependencies';

/** Durable relation is committed before Agent admission; retries rebuild only this exact execution intent. */
export async function ensureBotExecution(deps: DevSessionUseCaseDeps, repo: BotConversationRepository, starts: AgentStartRepository, conversation: BotConversation, operation: BotOperation): Promise<{ conversation: BotConversation; operation: BotOperation; start: AgentStart }> {
  let execution = operation.agentId ? await repo.execution(operation.agentId) : undefined;
  if (!execution) {
    const previous = conversation.currentAgentId ? await repo.execution(conversation.currentAgentId) : undefined;
    execution = { conversationId: conversation.id, taskId: conversation.taskId, agentId: newResourceId(), executionTaskId: conversation.reservedExecutionId ?? newResourceId() as TaskId,
      initialPrompt: operation.content, epoch: conversation.epoch, state: 'preparing', cursor: 0, requestId: operation.requestId, createdAt: deps.clock.now().toISOString(),
      ...(conversation.nativeSessionId ? { resumeSessionId: conversation.nativeSessionId, nativeSessionId: conversation.nativeSessionId } : {}),
      ...(previous || conversation.previousExecutionId ? { previousExecutionId: previous?.executionTaskId ?? conversation.previousExecutionId } : {}) };
    conversation = { ...conversation, currentAgentId: execution.agentId, reservedExecutionId: undefined };
    operation = { ...operation, agentId: execution.agentId };
    await repo.attachExecution(conversation, operation, execution);
  }
  let start = await starts.get(execution.agentId);
  if (!start) {
    start = startIntent(conversation, operation, execution);
    await starts.insert(start);
  }
  if (start.execution.runtimeImage && !execution.previousExecutionId) await deps.runtimeImages!.confirm(start.execution.runtimeImage, { type: 'agent', id: start.execution.taskId });
  return { conversation, operation, start };
}

function startIntent(conversation: BotConversation, operation: BotOperation, execution: BotExecution): AgentStart {
  return { agentId: execution.agentId, taskId: conversation.taskId, createdBy: conversation.createdBy, compute: conversation.compute, computeName: conversation.computeName,
    profile: conversation.profile, permission: PLATFORM_AGENT_PERMISSION, state: 'pending', cursor: 0, finalized: false, createdAt: execution.createdAt,
    execution: { ...conversation.executionConfig, taskId: execution.executionTaskId, runnerId: newResourceId(), ...(execution.previousExecutionId ? { previousTaskId: execution.previousExecutionId } : {}) },
    request: { prompt: operation.content!, ...(execution.resumeSessionId ? { resumeSessionId: execution.resumeSessionId } : {}),
      botContext: { volumeUid: conversation.volumeUid!, conversationId: conversation.id, epoch: conversation.epoch, requestId: operation.requestId, mode: execution.resumeSessionId ? 'existing' : 'create' } } };
}

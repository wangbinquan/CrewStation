import type { BotExecutionDto, BotReceiptDto, BotConversationDto, TaskId, UserId } from '@crewstation/contracts';
import type { AgentStart } from './agentStarts';

export interface BotConversation {
  id: string; taskId: TaskId; revision: number; epoch: number; createdBy: UserId;
  compute: string; computeName: string; protocol: string; profile: AgentStart['profile'];
  reservedExecutionId?: TaskId; previousExecutionId?: TaskId;
  executionConfig: Omit<AgentStart['execution'], 'taskId' | 'runnerId' | 'previousTaskId'>;
  state: BotConversationDto['state']; continuity: BotConversationDto['continuity'];
  nativeSessionId?: string; volumeUid?: string; currentAgentId?: string; reason?: string;
  createdAt: string; updatedAt: string;
}
export interface BotExecution extends BotExecutionDto {
  resumeSessionId?: string;
  conversationId: string; taskId: TaskId; cursor: number; requestId: string; previousExecutionId?: TaskId;
}
export interface BotOperation {
  closed?: boolean;
  taskId: TaskId; requestId: string; digest: string; kind: 'message' | 'interrupt' | 'fresh'; content?: string;
  receipt: BotReceiptDto; agentId?: string; expectedExecutionId?: TaskId; createdAt: string;
}
export interface BotConversationRepository {
  withLock<T>(taskId: TaskId, operation: () => Promise<T>): Promise<T>;
  get(taskId: TaskId): Promise<BotConversation | undefined>;
  save(conversation: BotConversation): Promise<void>;
  accept(conversation: BotConversation, operation: BotOperation): Promise<void>;
  operation(taskId: TaskId, requestId: string): Promise<BotOperation | undefined>;
  pending(taskId: TaskId): Promise<BotOperation[]>;
  updateOperation(operation: BotOperation): Promise<void>;
  execution(agentId: string): Promise<BotExecution | undefined>;
  attachExecution(conversation: BotConversation, operation: BotOperation, execution: BotExecution): Promise<void>;
  putExecution(execution: BotExecution): Promise<void>;
  history(taskId: TaskId, after: string | undefined, limit: number): Promise<BotExecution[]>;
  list(after: string | undefined, limit: number): Promise<BotConversation[]>;
}

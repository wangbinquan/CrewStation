import type { Actor, AgentInstanceDto, BranchDto, DevSessionDto, OpenDevSessionRequest, ProjectId, PublishRequest, ReleaseDto, SendAgentMessageRequest, StartDevAgentRequest, TaskId } from '@crewstation/contracts';

/** dev-session 对外能力：一项目一会话、分支、并行流式 Agent、从会话发布、空闲提醒。 */
export interface DevSessionModuleApi {
  readonly name: 'dev-session';
  openSession(actor: Actor, projectId: ProjectId, input: OpenDevSessionRequest): Promise<DevSessionDto>;
  getSession(actor: Actor, projectId: ProjectId): Promise<DevSessionDto | undefined>;
  listBranches(actor: Actor, projectId: ProjectId): Promise<BranchDto[]>;
  releaseSession(actor: Actor, projectId: ProjectId, options?: { force?: boolean }): Promise<{ session: DevSessionDto; unpushed: string[] }>;
  startAgent(actor: Actor, taskId: TaskId, input: StartDevAgentRequest): Promise<AgentInstanceDto>;
  sendMessage(actor: Actor, taskId: TaskId, agentId: string, input: SendAgentMessageRequest): Promise<void>;
  cancelAgent(actor: Actor, taskId: TaskId, agentId: string): Promise<void>;
  listAgents(actor: Actor, taskId: TaskId): Promise<AgentInstanceDto[]>;
  publish(actor: Actor, projectId: ProjectId, input: PublishRequest): Promise<ReleaseDto>;
  touch(taskId: TaskId): Promise<void>;
  sendIdleReminders(): Promise<number>;
}

import type { BusinessExecutionProof, TaskId } from '@crewstation/contracts';
import type { AgentProtocol, BusinessMaterialRequest, BusinessAgentCapabilities, ProjectId, StartAgentCommand, RuntimeImageExecutionSnapshot, SubmitBusinessSubtaskV3 } from '@crewstation/contracts';

export interface AgentSecretVersion { definitionId: string; itemId: string; version: number }
export interface ResolvedBusinessCompute {
  businessExecution?: BusinessExecutionProof;
 id: string; name: string; revision: number; protocol: AgentProtocol; taskProfile?: string; image: string }
type MaterialContent = Omit<BusinessMaterialRequest, 'requestKey' | 'fence'>;

/** No secret values persist here. The protected nonce binds dispatch bytes without publishing a secret oracle. */
export interface ExecutionAgentPlan {
  kind: 'agent-plan';
  sessionKey: TaskId;
  volumeUid: string;
  credentialStamp?: string;
  request: Extract<SubmitBusinessSubtaskV3, { kind: 'agent' }>;
  projectId: ProjectId;
  compute: ResolvedBusinessCompute;
  runtimeImage?: RuntimeImageExecutionSnapshot;
  command: StartAgentCommand;
  material: MaterialContent;
  secretVersions: AgentSecretVersion[];
  secretMcp: Array<{ name: string; headers: Record<string, string> }>;
  nonce: string;
}
export const BUSINESS_AGENT_CAPABILITIES: BusinessAgentCapabilities = {
  events: true, usage: 'incremental', resume: true, systemPrompt: true, skills: true,
  mcp: true, platformDelegation: false, opaqueInternalDelegation: true,
};

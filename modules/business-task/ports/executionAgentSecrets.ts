import type { ProjectId } from '@crewstation/contracts';

import type { AgentSecretVersion } from '../domain/executionAgent';
export type { AgentSecretVersion } from '../domain/executionAgent';
/** Only the config owner can resolve project-scoped immutable secret versions. */
export interface ExecutionAgentSecrets {
  versions(projectId: ProjectId, ids: readonly string[]): Promise<AgentSecretVersion[]>;
  render(projectId: ProjectId, versions: readonly AgentSecretVersion[]): Promise<Record<string, string>>;
}

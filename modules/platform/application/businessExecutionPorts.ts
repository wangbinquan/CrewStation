export { executionHandoffPorts } from './executionHandoffPorts';
import type { Actor, ConfigEnv, ProjectId, WorkloadIdentity } from '@crewstation/contracts';
import type { BusinessImageBindings } from './businessImagePorts';
import { businessImagePorts } from './businessImagePorts';

type Stamp = { definitionId: string; itemId: string; version: number };
interface ConfigSecrets {
  secretDefinitionVersions(actor: Actor, projectId: ProjectId, env: ConfigEnv, ids: readonly string[]): Promise<Stamp[]>;
  renderPinnedSecretDefinitions(projectId: ProjectId, env: ConfigEnv, stamps: readonly Stamp[]): Promise<Record<string, string>>;
}
interface Sources { resolveServiceSource(token: string): Promise<(WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> }) | undefined> }
/** Narrow owner capabilities, reachable only after the business service verifies the source Pod and parent ownership. */
export function businessExecutionPorts(images: BusinessImageBindings, config: ConfigSecrets, identity: Sources, actor: Actor) {
  return {
    runtimeImages: businessImagePorts(images, actor),
    executionSources: { resolve: (token: string) => identity.resolveServiceSource(token) },
    agentSecrets: {
      versions: (projectId: ProjectId, ids: readonly string[]) => config.secretDefinitionVersions(actor, projectId, 'production', ids),
      render: (projectId: ProjectId, stamps: readonly Stamp[]) => config.renderPinnedSecretDefinitions(projectId, 'production', stamps),
    },
  };
}

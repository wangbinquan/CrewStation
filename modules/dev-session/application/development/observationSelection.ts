import type { DevelopmentStartIntent, ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { AgentStart } from '../../ports/agentStarts';
import type { ResolvedCompute } from '../../ports/platform';
import type { DevSessionUseCaseDeps } from '../dependencies';
import { developmentObservationIntent, developmentObservationSelected } from '../../domain/development/observationSelection';

/** Metadata is fixed before reserving resources; credential material is deferred to dispatch. */
export async function freezeDevelopmentObservation(deps: Pick<DevSessionUseCaseDeps, 'compute' | 'settings'>, projectId: ProjectId, start: AgentStart, resolved: ResolvedCompute): Promise<DevelopmentStartIntent | undefined> {
  if (!developmentObservationSelected(deps.settings, projectId, start.profile)) return undefined;
  if (resolved.protocol !== 'opencode' || !deps.compute.launchMetadata) throw precondition('原生用量验证配置要求 OpenCode 和固定修订启动元数据');
  const metadata = await deps.compute.launchMetadata(start.profile);
  if (metadata.id !== start.profile.profileId || metadata.revision !== start.profile.revision || metadata.protocol !== 'opencode')
    throw precondition('原生用量验证配置的启动元数据不匹配已受理的算力修订');
  return developmentObservationIntent(projectId, start, metadata.launch, deps.settings.mcp);
}

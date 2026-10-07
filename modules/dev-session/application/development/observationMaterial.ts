import type { StartAgentCommand } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { AgentStart } from '../../ports/agentStarts';
import type { DevelopmentUsageOwnerRecord } from '../../ports/developmentUsage';
import type { DevSessionUseCaseDeps } from '../dependencies';
import { profileLaunchFields } from '../profileLaunch';

/** Dispatch calls this only after independent original registration and fresh healthy empty journal proof. */
export async function developmentObservationMaterial(deps: DevSessionUseCaseDeps, start: AgentStart, original: DevelopmentUsageOwnerRecord): Promise<StartAgentCommand> {
  const intent = original.intent;
  const credential = await deps.credentials.issueDevSessionToken({ taskId: start.taskId,
    projectId: intent.identity.projectId, serviceId: original.context.serviceId, userId: start.createdBy });
  const launch = await profileLaunchFields(deps, { profileId: intent.profileId, revision: intent.profileRevision }, start.agentId);
  return { id: `start-${start.agentId}`, type: 'startAgent', agentId: intent.identity.agentId, ...launch,
    permission: intent.permission, mode: intent.mode,
    ...(intent.cwd !== null ? { cwd: intent.cwd } : {}), ...(intent.initialPrompt !== null ? { initialPrompt: intent.initialPrompt } : {}),
    ...(intent.resumeSessionId !== null ? { resumeSessionId: intent.resumeSessionId } : {}), ...(intent.systemPrompt !== null ? { systemPrompt: intent.systemPrompt } : {}),
    mcp: intent.mcp.map((m) => ({ ...m, headers: { [IDENTITY_HEADERS.devSessionToken]: credential.token } })), env: {} };
}

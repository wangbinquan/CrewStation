import type { AgentPermission, DevelopmentStartIntent, LaunchSpec, ProfileRevisionRef, ProjectId, TaskId } from '@crewstation/contracts';
import { DevelopmentStartIntentSchema } from '@crewstation/contracts';
/** Pure accepted facts used by the domain; repositories and platform settings stay in application/ports. */
interface ObservationSettings {
  readonly developmentNativeObservationAdmissions?: readonly { projectId: string; profileId: string; profileRevision: number }[];
}
interface ObservationStart {
  readonly agentId: string;
  readonly taskId: TaskId;
  readonly profile: ProfileRevisionRef;
  readonly permission: AgentPermission;
  readonly request: { readonly prompt: string; readonly cwd?: string; readonly resumeSessionId?: string };
  readonly execution: { readonly taskId: TaskId };
}

export function developmentObservationSelected(settings: ObservationSettings, projectId: ProjectId, profile: ProfileRevisionRef): boolean {
  return settings.developmentNativeObservationAdmissions?.some((entry) => entry.projectId === projectId
    && entry.profileId === profile.profileId && entry.profileRevision === profile.revision) ?? false;
}

export function developmentObservationIntent(projectId: ProjectId, start: ObservationStart, launch: LaunchSpec, mcp: readonly { name: string; url: string }[]): DevelopmentStartIntent {
  return DevelopmentStartIntentSchema.parse({
    version: 1,
    identity: { projectId, taskId: start.taskId, executionId: start.execution.taskId, agentId: start.agentId,
      sourceKind: 'development-agent', executionGeneration: 1 },
    profileId: start.profile.profileId, profileRevision: start.profile.revision, launch,
    permission: start.permission, mode: 'interactive', initialPrompt: start.request.prompt,
    cwd: start.request.cwd ?? null, resumeSessionId: start.request.resumeSessionId ?? null, systemPrompt: null,
    mcp: mcp.map(({ name, url }) => ({ name, url })),
    nativeUsageLineageKey: `cs-development-workspace:${projectId}:${start.taskId}:opencode`, nativeSource: { version: 2 },
  });
}

/** A restart is a real new execution, retaining the original selection and launch lineage. */
export function restartDevelopmentObservationIntent(intent: DevelopmentStartIntent | undefined, next: { agentId: string; taskId: TaskId }): DevelopmentStartIntent | undefined {
  if (!intent) return undefined;
  return DevelopmentStartIntentSchema.parse({ ...intent, identity: { ...intent.identity, agentId: next.agentId, executionId: next.taskId } });
}

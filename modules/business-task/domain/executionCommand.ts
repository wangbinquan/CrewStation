import type { BusinessCommandSecretEnvironment, ProjectId, SubmitBusinessSubtaskV3, TasksSpec } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

export type CommandRequest = Extract<SubmitBusinessSubtaskV3, { kind: 'command' }>;
export interface ExecutionCommandPlan { kind: 'command-plan'; projectId: ProjectId; request: CommandRequest; secretEnvironment: BusinessCommandSecretEnvironment }
/** Existing literals retain their contract; every value of an explicitly restricted release obeys its allowlist. */
export function authorizeCommandEnvironment(spec: TasksSpec, request: CommandRequest): Record<string, string> {
  const references: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.env)) {
    if ((typeof value !== 'string' || spec.commandBusinessConfig) && !spec.commandBusinessConfig?.allowedEnvNames.includes(name)) throw validation('发布契约未允许命令环境变量', { code: 'invalid_configuration', field: name });
    if (typeof value !== 'string') references[name] = value.secret.configDefinitionId;
  }
  return references;
}

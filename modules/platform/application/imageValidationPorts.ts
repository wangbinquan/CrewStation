import type { Actor, BeforeStartMaterial, LaunchSpec, ProjectId, RuntimeImageExecutionSnapshot, RuntimeImageProbeInput, RuntimeImageProbeResult, RuntimeImageValidationDto, TerminalTest, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

interface ValidationPorts {
  authorize(actor: Actor, projectId: ProjectId, action: 'develop'): Promise<unknown>;
  isAdmin(id: UserId): Promise<boolean>;
  launchMaterial(ref: { profileId: string; revision: number }): Promise<{ launch: LaunchSpec; beforeStart: BeforeStartMaterial; taskProfile?: string; terminalTest?: TerminalTest }>;
  runtime(): { runRuntimeImageProbe(input: RuntimeImageProbeInput, heartbeat: () => Promise<boolean>): Promise<RuntimeImageProbeResult>; stopRuntimeImageProbe(id: string): Promise<boolean> };
}
type Context = { validation: RuntimeImageValidationDto & { deadline?: string }; snapshot: RuntimeImageExecutionSnapshot };

export function imageValidationPorts(ports: ValidationPorts) {
  return {
    run: async ({ validation, snapshot }: Context, heartbeat: () => Promise<boolean>): Promise<RuntimeImageProbeResult> => {
      const actor = { userId: validation.createdBy as UserId, isAdmin: await ports.isAdmin(validation.createdBy as UserId) };
      await ports.authorize(actor, validation.projectId as ProjectId, 'develop');
      if (validation.target.usage === 'service') throw precondition('服务隔离用途验证尚未配置');
      if (!validation.deadline) throw precondition('验证缺少固定截止时间');
      const agent = validation.target.usage === 'agent' ? { ...validation.target.profile, ...(await ports.launchMaterial(validation.target.profile)) } : undefined;
      return ports.runtime().runRuntimeImageProbe({ validationId: validation.id, projectId: validation.projectId, deadline: validation.deadline, snapshot, ...(agent ? { agent } : {}) }, heartbeat);
    },
    stop: ({ validation }: Context) => ports.runtime().stopRuntimeImageProbe(validation.id),
  };
}

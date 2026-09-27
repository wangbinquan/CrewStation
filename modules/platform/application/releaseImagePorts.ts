import type { Actor, ComputeProfileSelector, Manifest, ProjectId, ReleaseId, RuntimeImageExecutionSnapshot, RuntimeImageSelection, RuntimeImageValidationTarget, TasksSpec, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

interface ReleaseImageBindings {
  reserveImage(actor: Actor, projectId: string, input: { owner: { type: 'release'; id: string }; selection: RuntimeImageSelection; target: RuntimeImageValidationTarget }): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirmReference(versionId: string, owner: { type: 'release'; id: string }): Promise<void>;
}
interface ReleaseIdentity { projectId: ProjectId; releaseId: ReleaseId; userId: UserId }
export interface RetainedReleaseImage { versionId: string; ownerId: string }
const ids = (selection: RuntimeImageSelection) => [...new Set([selection.runtimeImageVersionId, ...(selection.allowedRuntimeImageVersionIds ?? [])].filter((id): id is string => !!id))];

export function releaseImagePorts(images: ReleaseImageBindings, options: {
  isAdmin(id: UserId): Promise<boolean>;
  pinServiceImage(repository: string, image: string): Promise<string>;
  resolveProfile(projectId: ProjectId, selector: ComputeProfileSelector): Promise<{ id: string; revision: number }>;
}) {
  const actor = async (id: UserId) => ({ userId: id, isAdmin: await options.isAdmin(id) });
  return {
    pinBuiltImage: options.pinServiceImage,
    reserve: async (input: ReleaseIdentity & { versionId: string; service: Manifest['spec']['service'] }) => {
      const service = input.service;
      const snapshot = await images.reserveImage(await actor(input.userId), input.projectId, { selection: { runtimeImageVersionId: input.versionId }, target: { usage: 'service', command: service.command, port: service.port, healthPath: service.healthPath, ...(service.probes ? { probes: service.probes } : {}) }, owner: { type: 'release', id: input.releaseId } });
      if (!snapshot) throw precondition('服务镜像版本未解析'); return snapshot;
    },
    confirm: (versionId: string, id: string) => images.confirmReference(versionId, { type: 'release', id }),
    reserveTaskImages: async (input: ReleaseIdentity & { tasks: TasksSpec }): Promise<RetainedReleaseImage[]> => {
      const current = await actor(input.userId), selections: Array<{ key: string; versions: string[]; target: RuntimeImageValidationTarget }> = [{ key: 'task', versions: ids(input.tasks), target: { usage: 'task' } }];
      for (const profile of input.tasks.agentProfiles) {
        const versions = ids(profile); if (!versions.length) continue;
        const resolved = await options.resolveProfile(input.projectId, profile.compute);
        selections.push({ key: `agent:${profile.id}`, versions, target: { usage: 'agent', profile: { profileId: resolved.id, revision: resolved.revision } } });
      }
      const retained: RetainedReleaseImage[] = [];
      for (const selection of selections) for (const versionId of selection.versions) {
        const ownerId = `${input.releaseId}:${selection.key}`;
        const snapshot = await images.reserveImage(current, input.projectId, { selection: { runtimeImageVersionId: versionId }, target: selection.target, owner: { type: 'release', id: ownerId } });
        if (!snapshot) throw precondition('发布声明的任务或 Agent 镜像未解析');
        retained.push({ versionId, ownerId });
      }
      return retained;
    },
    confirmTaskImages: async (references: readonly RetainedReleaseImage[]) => {
      for (const ref of references) await images.confirmReference(ref.versionId, { type: 'release', id: ref.ownerId });
    },
  };
}

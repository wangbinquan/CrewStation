import type { RuntimeImageHistoryItem, RuntimeImageHistoryRead } from '@crewstation/contracts';
import type { Actor, ProjectId, RuntimeImageExecutionSnapshot, RuntimeImageSelection, RuntimeImageValidationTarget } from '@crewstation/contracts';

interface ImageBindings {
  getDevelopmentImages(actor: Actor, projectId: string): Promise<{ developmentTask: RuntimeImageSelection; developmentAgents: Array<{ profileId: string; selection: RuntimeImageSelection }> }>;
  reserveImage(actor: Actor, projectId: string, input: { owner: { type: 'session' | 'agent'; id: string }; selection: RuntimeImageSelection; target: RuntimeImageValidationTarget; requestedVersionId?: string }): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirmReference(versionId: string, owner: { type: 'session' | 'agent'; id: string }): Promise<void>;
  copyReference(projectId: string, versionId: string, from: { type: 'agent'; id: string }, to: { type: 'agent'; id: string }): Promise<void>;
}

export function developmentImagePorts(images: ImageBindings) {
  return {
    reserve: async (actor: Actor, projectId: ProjectId, owner: { type: 'session' | 'agent'; id: string }, requestedVersionId?: string, profile?: { profileId: string; revision: number }) => {
      const policy = await images.getDevelopmentImages(actor, projectId);
      const selection = profile ? policy.developmentAgents.find((entry) => entry.profileId === profile.profileId)?.selection ?? {} : policy.developmentTask;
      return images.reserveImage(actor, projectId, { owner, selection, ...(requestedVersionId ? { requestedVersionId } : {}), target: profile ? { usage: 'agent', profile } : { usage: 'task' } });
    },
    confirm: (snapshot: RuntimeImageExecutionSnapshot, owner: { type: 'session' | 'agent'; id: string }) => images.confirmReference(snapshot.versionId, owner),
    restore: (projectId: ProjectId, snapshot: RuntimeImageExecutionSnapshot, from: string, to: string) => images.copyReference(projectId, snapshot.versionId, { type: 'agent', id: from }, { type: 'agent', id: to }),
  };
}

/** A business owner can share the Agent category with development executions; unknown is not a release proof. */
export function imageReferenceOwnerPorts(owners: () => {
  businessTask?: { imageReferenceState(input: ReferenceQuery): Promise<ReferenceState> };
  taskRuntime?: { imageReferenceState(input: ReferenceQuery): Promise<ReferenceState> };
}) {
  return { inspect: async (input: ReferenceQuery): Promise<ReferenceState> => {
    const ports = owners();
    const business = await ports.businessTask?.imageReferenceState(input) ?? 'unknown';
    return business === 'unknown' ? await ports.taskRuntime?.imageReferenceState(input) ?? 'unknown' : business;
  } };
}
interface ReferenceQuery { projectId: string; versionId: string; ownerType: string; ownerId: string }
type ReferenceState = 'active' | 'released' | 'unknown';

interface HistoryOwner { imageHistory(input: RuntimeImageHistoryRead): Promise<RuntimeImageHistoryItem[]> }
export function imageOwnerPorts(owners: () => { businessTask?: { imageReferenceState(input: ReferenceQuery): Promise<ReferenceState> }; taskRuntime?: HistoryOwner & { imageReferenceState(input: ReferenceQuery): Promise<ReferenceState> }; release?: HistoryOwner }) {
  return { referenceOwners: imageReferenceOwnerPorts(owners), executionHistory: { list: async (input: RuntimeImageHistoryRead) => {
    const ports = owners();
    if (!ports.taskRuntime || !ports.release) throw new Error('运行镜像使用记录模块尚未装配');
    const pages = await Promise.all([ports.taskRuntime.imageHistory(input), ports.release.imageHistory(input)]);
    return pages.flat().sort((a, b) => b.id.localeCompare(a.id)).slice(0, input.limit);
  } } };
}

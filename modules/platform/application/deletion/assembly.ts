import { PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionOperation, ProjectDeletionOwner, ProjectId, TaskVolumeTarget } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { InfrastructureOriginSources } from '../../ports/infrastructureOrigins';
import type { NativeDeletionHistoryInputs, NativeDeletionHistoryPort } from '../../ports/projectResourceSources';
import type { RuntimeStopReceipts } from '../../ports/runtimeStops';
import { projectDeletionIntents, type RootDeletionProject } from './intents';
import { nativeDeletionRetainedHistory, projectResourcePhysics } from './resourcePhysics';

type Grant = (context: ProjectDeletionContext) => Promise<void>;
type Physics = ReturnType<typeof projectResourcePhysics>;
interface ClusterAdmission {
  assertGrant: Grant; seal: Grant; assertSealed: Grant;
  ownsVolume(projectId: string, volume: { kind: string; metadata: { name: string; uid?: string }; [key: string]: unknown }): Promise<boolean>;
}
interface VolumeReceipts {
  known(projectId: ProjectId): Promise<TaskVolumeTarget[]>;
  get(context: ProjectDeletionContext, key: string): Promise<{ key: string; target: TaskVolumeTarget; digest: string | null; observedAt: string | null } | undefined>;
  pin(context: ProjectDeletionContext, key: string, target: TaskVolumeTarget): Promise<void>;
  reclaimed(context: ProjectDeletionContext, key: string, digest: string, observedAt: string): Promise<void>;
}
interface PodReceipts extends RuntimeStopReceipts {
  save(context: ProjectDeletionContext, receipt: { key: string; uid: string; nodeUid: string | null; digest: string; observedAt: string }): Promise<void>;
}
interface RootResources {
  projectDeletion: NativeDeletionHistoryInputs['resources']['projectDeletion'] & {
    owner(physics: Physics, assertGrant: Grant): ProjectDeletionOwner;
    sealClusterAdmission(context: ProjectDeletionContext, grant: Grant): Promise<void>;
    assertClusterAdmission(context: ProjectDeletionContext, grant: Grant): Promise<void>;
    ownsVolume(projectId: ProjectId, volume: { name: string; uid: string; claim?: { namespace: string; uid: string } }): Promise<boolean>;
    podStopReceipts(grant: Grant): PodReceipts;
    volumeReclamation(grant: Grant): VolumeReceipts;
  };
}
interface RootCluster {
  projectDeletionOwner(admission: ClusterAdmission): ProjectDeletionOwner;
  projectPodProtection(admission: ClusterAdmission, receipts: PodReceipts): Parameters<typeof projectResourcePhysics>[0];
  projectVolumeReclamation(admission: ClusterAdmission, receipts: VolumeReceipts): Parameters<typeof projectResourcePhysics>[1];
}
interface RootProvisioning {
  projectDeletionOwner(input: { origins: InfrastructureOriginSources; coordinator(id: ProjectId): Promise<{ projectId: ProjectId; operationId: string } | undefined> }): ProjectDeletionOwner;
  finalizeProjectDeletion(executor: object, operation: ProjectDeletionOperation): Promise<void>;
}
interface AssemblyInput {
  project: RootDeletionProject & { assertProjectDeletionGrant: Grant; projectDeletionCoordinator(id: ProjectId): Promise<{ projectId: ProjectId; operationId: string } | undefined> };
  owners: readonly (ProjectDeletionOwner | undefined)[];
  identity(grant: Grant): ProjectDeletionOwner;
  resources: RootResources; cluster: RootCluster;
  data: NativeDeletionHistoryInputs['data']; adminUrl: string;
  dataControl?: { owner(input: { history: NativeDeletionHistoryPort; assertGrant: Grant }): ProjectDeletionOwner };
  origins: InfrastructureOriginSources;
}

/** Actual factories only; an unavailable owner never becomes an empty participant. */
export function assembleProjectDeletion(input: AssemblyInput, provisioning: RootProvisioning) {
  if (!input.dataControl) throw precondition('永久删除缺少原 data-control 物理来源');
  const grant = input.project.assertProjectDeletionGrant, resources = input.resources.projectDeletion;
  const admission: ClusterAdmission = { assertGrant: grant, seal: (context) => resources.sealClusterAdmission(context, grant),
    assertSealed: (context) => resources.assertClusterAdmission(context, grant),
    ownsVolume: async (id, volume) => {
      const claim = (volume['spec'] as { claimRef?: { namespace?: string; uid?: string } } | undefined)?.claimRef;
      if (!volume.metadata.uid || volume.kind === 'PersistentVolume' && (!claim?.uid || !claim.namespace)) return false;
      return resources.ownsVolume(id as ProjectId, { name: volume.metadata.name, uid: volume.metadata.uid,
        ...(claim?.uid && claim.namespace ? { claim: { namespace: claim.namespace, uid: claim.uid } } : {}) });
    } };
  const physics = projectResourcePhysics(input.cluster.projectPodProtection(admission, resources.podStopReceipts(grant)),
    input.cluster.projectVolumeReclamation(admission, resources.volumeReclamation(grant)));
  const owners = [...input.owners, input.identity(grant), resources.owner(physics, grant), input.cluster.projectDeletionOwner(admission),
    input.dataControl.owner({ history: nativeDeletionRetainedHistory(input.data, input.resources, input.adminUrl), assertGrant: grant }),
    provisioning.projectDeletionOwner({ origins: input.origins, coordinator: input.project.projectDeletionCoordinator })];
  const names = owners.map((owner) => owner?.participant);
  if (owners.some((owner) => !owner) || names.length !== PROJECT_DELETION_PARTICIPANTS.length || new Set(names).size !== names.length || PROJECT_DELETION_PARTICIPANTS.some((name) => !names.includes(name))) throw precondition('永久删除缺少完整22方原资源 owner');
  return { intents: projectDeletionIntents(input.project, provisioning.finalizeProjectDeletion), owners: owners as readonly ProjectDeletionOwner[] };
}

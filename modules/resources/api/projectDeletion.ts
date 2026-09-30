import type { ProjectDeletionContext, ProjectDeletionOwner, ProjectDeletionStepResult, ProjectId } from '@crewstation/contracts';
import type { ProjectPodStopReceipts } from './deletionPods';
import type { ProjectVolumeReclamationStore } from './deletionVolumes';

export interface ResourceDeletionPhysics {
  inspect: ProjectDeletionOwner['inspect'];
  /** 在 stop 前保护原实例，确保 kubelet 终止状态可先持久确认，再正常释放自己的保护。 */
  seal(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  /** 实际来源确认停止、回收和复盘；台账 stopped 不能代替物理证明。 */
  stop(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  purge(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  prove(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  verify(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
}
export interface ResourceProjectDeletion {
  volumeReclamation(assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectVolumeReclamationStore;
  podStopReceipts(assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectPodStopReceipts;
  ownsVolume(projectId: ProjectId, volume: { name: string; uid: string; claim?: { namespace: string; uid: string } }): Promise<boolean>;
  owner(physics: ResourceDeletionPhysics, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner;
  sealClusterAdmission(context: ProjectDeletionContext, assertGrant: (context: ProjectDeletionContext) => Promise<void>): Promise<void>;
  assertClusterAdmission(context: ProjectDeletionContext, assertGrant: (context: ProjectDeletionContext) => Promise<void>): Promise<void>;
  withAdmission(projectId: ProjectId, work: () => Promise<void>): Promise<boolean>;
}

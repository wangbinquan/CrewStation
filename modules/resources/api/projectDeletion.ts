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
  /** 读尽同一快照内的保留台账；历史身份缺口不表示原实体已消失。 */
  nativePostgresHistory(projectId: ProjectId): Promise<NativePostgresHistory>;
  volumeReclamation(assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectVolumeReclamationStore;
  podStopReceipts(assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectPodStopReceipts;
  ownsVolume(projectId: ProjectId, volume: { name: string; uid: string; claim?: { namespace: string; uid: string } }): Promise<boolean>;
  owner(physics: ResourceDeletionPhysics, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner;
  sealClusterAdmission(context: ProjectDeletionContext, assertGrant: (context: ProjectDeletionContext) => Promise<void>): Promise<void>;
  assertClusterAdmission(context: ProjectDeletionContext, assertGrant: (context: ProjectDeletionContext) => Promise<void>): Promise<void>;
  withAdmission(projectId: ProjectId, work: () => Promise<void>): Promise<boolean>;
}

export interface NativePostgresChild {
  readonly kind: 'PostgresDatabase' | 'PostgresRole';
  readonly name: string;
  readonly namespace?: string;
}
export interface NativePostgresHistoryRecord {
  readonly id: string;
  readonly kind: string;
  readonly owner: { readonly module: string; readonly ref: string };
  readonly desired: string;
  readonly phase: string;
  readonly version: number;
  readonly generation: number;
  readonly compacted: boolean;
  readonly spec: unknown;
  readonly declared: readonly NativePostgresChild[];
  readonly observed: readonly (NativePostgresChild & { readonly uid?: string; readonly expected: boolean })[];
}
export interface NativePostgresHistory {
  readonly retainedRecordsComplete: true;
  readonly revision: string;
  readonly records: readonly NativePostgresHistoryRecord[];
  /** 不由保留台账断言原生实体历史完整；须由原生独立持久事实补齐。 */
  readonly gaps: readonly { readonly resourceId: string; readonly code: 'native-identity-compacted' | 'native-revisions-unavailable' | 'native-declaration-invalid' | 'native-owner-unknown'; readonly message: string }[];
}

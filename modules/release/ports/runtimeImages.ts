import type { Manifest, ProjectId, ReleaseId, RuntimeImageExecutionSnapshot, TasksSpec, UserId } from '@crewstation/contracts';

/** 发布仅采用已通过精确 command／port／probes 验证的完整服务镜像。 */
export interface ReleaseRuntimeImages {
  reserveTaskImages?(input: { projectId: ProjectId; releaseId: ReleaseId; userId: UserId; tasks: TasksSpec }): Promise<Array<{ versionId: string; ownerId: string }>>;
  confirmTaskImages?(references: readonly { versionId: string; ownerId: string }[]): Promise<void>;
  pinBuiltImage?(repository: string, image: string): Promise<string>;
  reserve(input: { projectId: ProjectId; releaseId: ReleaseId; userId: UserId; versionId: string; service: Manifest['spec']['service'] }): Promise<RuntimeImageExecutionSnapshot>;
  confirm(versionId: string, releaseId: ReleaseId): Promise<void>;
}

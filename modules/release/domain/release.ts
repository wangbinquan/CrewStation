import type { Manifest, ProjectId, ReleaseId, ReleaseStatus, ServiceId, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { PhysicalSlot } from './slots';

/** 一次发布：平台创建的标签指向固定 SHA，构建、迁移、部署到待命槽后就绪；切流不属于发布。 */
export interface Release {
  /** Original key only for reconnecting an accepted pre-upgrade Job. */
  readonly legacyResourceId?: string;
  readonly id: ReleaseId;
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly tag: string;
  readonly commitSha: string;
  readonly branch: string;
  readonly status: ReleaseStatus;
  readonly targetSlot: PhysicalSlot;
  readonly image?: string;
  readonly manifest?: Manifest;
  readonly configVersion?: number;
  /** 流水线的外部引用（构建 Job、迁移 Job）与步骤计数，供工作器续接。 */
  readonly pipeline: { buildRef?: string; migrationRef?: string; step: number; deployStartedAt?: string };
  readonly message?: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NEXT: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  pending: ['building', 'failed'],
  building: ['migrating', 'deploying', 'failed'],
  migrating: ['deploying', 'failed'],
  deploying: ['ready', 'failed'],
  ready: ['superseded'],
  failed: [],
  superseded: [],
};

export const IN_PROGRESS: readonly ReleaseStatus[] = ['pending', 'building', 'migrating', 'deploying'];

export function advance(release: Release, status: ReleaseStatus, now: Date, patch: Partial<Omit<Release, 'id' | 'status'>> = {}): Release {
  if (!NEXT[release.status].includes(status)) {
    throw precondition(`发布 ${release.tag} 不能从 ${release.status} 进入 ${status}`, { from: release.status, to: status });
  }
  return { ...release, ...patch, status, updatedAt: now };
}

export function isInProgress(release: Release): boolean {
  return IN_PROGRESS.includes(release.status);
}

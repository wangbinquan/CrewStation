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
  /**
   * 流水线的外部引用（构建 Job、迁移 Job）与步骤计数，供工作器续接。
   * `readyAt`：首次就绪的时刻；只有就绪过的版本才能从发布记录重新部署（RFC-021 §4）。
   */
  readonly pipeline: { buildRef?: string; migrationRef?: string; step: number; deployStartedAt?: string; readyAt?: string };
  readonly message?: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * ready → offline：所在的待命槽被下线；superseded／offline／failed → deploying：从发布记录重新部署（RFC-021）。
 * failed 只有就绪过的版本才允许，由用例按 `isRedeployable` 把关；ready → deploying 只给「就绪却不在任何槽上」的旧数据。
 */
const NEXT: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  pending: ['building', 'failed'],
  building: ['migrating', 'deploying', 'failed'],
  migrating: ['deploying', 'failed'],
  deploying: ['ready', 'failed'],
  ready: ['superseded', 'offline', 'deploying'],
  failed: ['deploying'],
  superseded: ['deploying'],
  offline: ['deploying'],
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

/** 就绪过：有首次就绪时刻，或者状态本身只能由就绪而来（升级前的旧记录没有 readyAt）。 */
export function hasBeenReady(release: Release): boolean {
  return release.pipeline.readyAt !== undefined || ['ready', 'superseded', 'offline'].includes(release.status);
}

/** 可以从发布记录重新部署（RFC-021 §4）：有镜像与 Manifest、就绪过、现在不在任何槽上、不在进行中。 */
export function isRedeployable(release: Release, onSlot: boolean): boolean {
  return !onSlot && !!release.image && !!release.manifest && hasBeenReady(release) && ['ready', 'superseded', 'offline', 'failed'].includes(release.status);
}

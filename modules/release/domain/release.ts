import type { BusinessReleaseMaterials } from '@crewstation/contracts';
import type { RuntimeImageExecutionSnapshot, Manifest, ProjectId, ReleaseId, ReleaseStatus, ServiceId, UserId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { ProjectDeletionInventorySchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { z } from 'zod';
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
   * `jobs: 'ledger'`：这次发布的构建、迁移 Job 由资源中心建（RFC-025 T8），流水线照 Job 记录判结果；两个起始时刻给它们兜底的时限。
   */
  readonly pipeline: { executionMaterials?: BusinessReleaseMaterials; runtimeImageSelections?: Array<{ versionId: string; ownerId: string }>; runtimeImage?: RuntimeImageExecutionSnapshot; buildRef?: string; migrationRef?: string; step: number; deployStartedAt?: string; readyAt?: string; jobs?: 'ledger'; buildStartedAt?: string; migrationStartedAt?: string };
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
  pending: ['building', 'migrating', 'deploying', 'failed'],
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

const deletionHash = z.string().regex(/^[a-f0-9]{64}$/);
export const RELEASE_CALLBACK_KINDS = ['publish', 'pipeline', 'slot', 'maintenance', 'handoff', 'sweep', 'ledger'] as const;
export const RELEASE_PHYSICAL_KINDS = ['builder', 'migration', 'slot', 'artifact', 'credential', 'callback'] as const;
export const ReleaseCallbackProcessSchema = z.object({
  podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253),
  pid: z.number().int().positive(), pidNamespace: z.string().regex(/^\d+$/), bootId: z.uuid(), startTicks: z.string().regex(/^\d+$/),
}).strict();
export const ReleaseCallbackRecordSchema = z.object({
  id: ResourceIdSchema, kind: z.enum(RELEASE_CALLBACK_KINDS), consumerId: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ResourceIdSchema,
  backendPid: z.number().int().positive(), process: ReleaseCallbackProcessSchema, inputDigest: deletionHash, exitKeyDigest: deletionHash,
  exited: z.boolean(), exitDigest: deletionHash.optional(), recoveryDigest: deletionHash.optional(),
}).strict().superRefine((record, context) => {
  if (record.exited !== !!record.exitDigest || record.recoveryDigest && !record.exited) context.addIssue({ code: 'custom', message: '原发布回调退出字段不完整' });
});
export type ReleaseCallbackProcess = z.infer<typeof ReleaseCallbackProcessSchema>;
export type ReleaseCallbackRecord = z.infer<typeof ReleaseCallbackRecordSchema>;
export function releaseCallbackIdentity(record: ReleaseCallbackRecord, recoveryDigest?: string): string {
  const { exited: _exited, exitDigest: _exitDigest, recoveryDigest: _recoveryDigest, ...birth } = record;
  return jsonHash({ ...birth, ...(recoveryDigest ? { recoveryDigest } : {}) });
}
const releaseContentSchema = z.object({
  inventory: ProjectDeletionInventorySchema,
  identityLinks: z.array(z.object({ kind: z.string().min(1), keys: z.array(z.string().min(1)).min(1), id: ResourceIdSchema }).strict()),
  rows: z.array(z.object({ table: z.string().min(1), key: z.string().min(1), identity: deletionHash }).strict()),
  consumers: z.array(z.object({ kind: z.enum(['release', 'slot', 'handoff', 'maintenance', 'callback']), id: z.string().min(1), serviceId: ResourceIdSchema, identity: deletionHash, state: z.string().min(1), aliases: z.array(z.string().min(1)) }).strict()),
  callbacks: z.array(ReleaseCallbackRecordSchema),
}).strict();
export const ReleasePhysicalScopeSchema = z.object({
  version: z.literal(1), projectId: ProjectIdSchema, originDigest: deletionHash,
  source: z.object({ identity: deletionHash, epoch: deletionHash, version: z.string().min(1) }).strict(),
  bindings: z.array(z.object({ kind: z.enum(['release', 'slot', 'handoff', 'maintenance', 'callback']), id: z.string().min(1), identity: deletionHash }).strict()),
  objects: z.array(z.object({ kind: z.enum(RELEASE_PHYSICAL_KINDS), id: z.string().min(1).max(512), identity: z.string().min(1).max(1024), sourceIdentity: deletionHash, count: z.number().int().nonnegative() }).strict()),
  coverage: z.array(z.object({ kind: z.enum(RELEASE_PHYSICAL_KINDS), identity: deletionHash, complete: z.literal(true) }).strict()),
}).strict().superRefine((scope, context) => {
  if (scope.coverage.length !== RELEASE_PHYSICAL_KINDS.length || new Set(scope.coverage.map((entry) => entry.kind)).size !== scope.coverage.length
    || new Set(scope.objects.map((entry) => JSON.stringify([entry.kind, entry.id]))).size !== scope.objects.length
    || new Set(scope.bindings.map((entry) => JSON.stringify([entry.kind, entry.id]))).size !== scope.bindings.length) context.addIssue({ code: 'custom', message: '发布独立来源覆盖不全或原身份重复' });
});
export const ReleaseDeletionScopeSchema = z.object({
  version: z.literal(1), target: z.object({ projectId: ProjectIdSchema, namespace: z.string().min(1), serviceId: ResourceIdSchema.optional() }).strict(),
  inventory: ProjectDeletionInventorySchema, content: releaseContentSchema, physical: ReleasePhysicalScopeSchema.nullable(),
}).strict();
export type ReleasePhysicalScope = z.infer<typeof ReleasePhysicalScopeSchema>;
export type ReleaseDeletionScope = z.infer<typeof ReleaseDeletionScopeSchema>;
export type ReleaseDeletionContent = ReleaseDeletionScope['content'];
export function releasePhysicalBindings(content: ReleaseDeletionContent, scope: ReleasePhysicalScope): boolean {
  const bindings = content.consumers.map((entry) => ({ kind: entry.kind, id: entry.id, identity: entry.identity })).sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
  const supplied = [...scope.bindings].sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
  return jsonHash(bindings) === jsonHash(supplied) && scope.originDigest === jsonHash({ projectId: scope.projectId, bindings, identityLinks: content.identityLinks });
}

/** 就绪过：有首次就绪时刻，或者状态本身只能由就绪而来（升级前的旧记录没有 readyAt）。 */
export function hasBeenReady(release: Release): boolean {
  return release.pipeline.readyAt !== undefined || ['ready', 'superseded', 'offline'].includes(release.status);
}

/** 可以从发布记录重新部署（RFC-021 §4）：有镜像与 Manifest、就绪过、现在不在任何槽上、不在进行中。 */
export function isRedeployable(release: Release, onSlot: boolean): boolean {
  return !onSlot && !!release.image && !!release.manifest && hasBeenReady(release) && ['ready', 'superseded', 'offline', 'failed'].includes(release.status);
}

import type {
  RuntimeImageBuildDto, RuntimeImageBuildRender, RuntimeImageDto, RuntimeImageExecutionSnapshot, RuntimeImageRevisionDto, RuntimeImageValidationDto, RuntimeImageVersionDto, SaveDevelopmentRuntimeImages,
} from '@crewstation/contracts';
import type { InspectedImage } from './inspectedImage';
import type { ProjectDeletionInventory } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { z } from 'zod';

export type RuntimeImage = RuntimeImageDto;
export type ImageRevision = RuntimeImageRevisionDto;
export type ImageVersion = RuntimeImageVersionDto;
export interface ImageBuild extends RuntimeImageBuildDto {
  readonly requestKey: string;
  readonly inputDigest: string;
  readonly epoch: number;
  readonly leaseOwner?: string;
  readonly leaseUntil?: string;
  readonly cancelRequestKey?: string;
  readonly executionEpoch: number;
  readonly resourcePlan?: RuntimeImageBuildRender;
  readonly gitCredentialIds?: readonly string[];
  readonly podUid?: string;
  readonly logCursor?: string;
  readonly pendingOutcome?: { readonly state: 'succeeded'; readonly image: InspectedImage } | { readonly state: 'failed'; readonly error: string };
}
export interface ImageValidation extends RuntimeImageValidationDto {
  readonly deadline?: string;
  readonly executionStartedAt?: string;
  readonly pendingOutcome?: { readonly verification?: 'runtime' | 'service-contract'; readonly state: 'passed' | 'failed' | 'unknown'; readonly observedImageId?: string; readonly error?: string; readonly checks: RuntimeImageValidationDto['checks'] };
  readonly cancelRequestKey?: string;
  readonly initializerSecretVersions?: RuntimeImageExecutionSnapshot['initializerSecretVersions'];
  readonly requestKey: string;
  readonly inputDigest: string;
  readonly epoch: number;
  readonly leaseOwner?: string;
  readonly leaseUntil?: string;
}
/** Source/initializer projects are dependencies even though the catalog definition itself is platform-owned. */
export function runtimeImageBuildProjects(build: ImageBuild, revision?: ImageRevision): string[] {
  return [...new Set([build.projectId, build.sourceProjectId, build.resourcePlan?.projectId, revision?.sourceProjectId, revision?.initializerProjectId].filter((id): id is string => !!id))].sort();
}
export interface RuntimeImageCallbackRecord {
  readonly id: string; readonly kind: 'build' | 'validation' | 'source' | 'initializer'; readonly consumerId: string;
  readonly projectIds: readonly string[]; readonly originalProjectIds: readonly string[]; readonly backendPid: number; readonly callbackPid: number;
  readonly callbackStartedAt: string; readonly inputDigest: string; readonly exitKeyDigest: string; readonly identity: string;
  readonly process: { podUid: string; containerId: string; nodeUid: string; nodeName: string };
  readonly exited: boolean; readonly exitDigest?: string; readonly recoveryDigest?: string;
}
export const RUNTIME_IMAGE_PHYSICAL_KINDS = ['builder', 'validation', 'artifact', 'credential', 'callback'] as const;
const deletionHash = z.string().regex(/^[a-f0-9]{64}$/);
export const RuntimeImagePhysicalScopeSchema = z.object({ version: z.literal(1), projectId: ProjectIdSchema, originDigest: deletionHash,
  source: z.object({ identity: deletionHash, epoch: deletionHash, version: z.string().min(1).max(80) }).strict(),
  objects: z.array(z.object({ kind: z.enum(RUNTIME_IMAGE_PHYSICAL_KINDS), id: z.string().min(1).max(512), identity: deletionHash, sourceIdentity: deletionHash, count: z.number().int().nonnegative(),
    consumerId: ResourceIdSchema.optional(), consumerIdentity: deletionHash.optional() }).strict().refine((entry) => !!entry.consumerId === !!entry.consumerIdentity, '原消费者绑定必须成对提供')),
  coverage: z.array(z.object({ kind: z.enum(RUNTIME_IMAGE_PHYSICAL_KINDS), identity: deletionHash, complete: z.literal(true) }).strict()) }).strict().refine((scope) => {
  const coverage = scope.coverage.map((entry) => entry.kind), objects = scope.objects.map((entry) => entry.kind + ':' + entry.id);
  return new Set(coverage).size === coverage.length && jsonHash([...coverage].sort()) === jsonHash([...RUNTIME_IMAGE_PHYSICAL_KINDS].sort()) && new Set(objects).size === objects.length;
}, '运行镜像原生产者、制品、凭据或回调范围不完整／重复');
export const RuntimeImageCallbackRecordSchema = z.object({ id: ResourceIdSchema, kind: z.enum(['build', 'validation', 'source', 'initializer']), consumerId: ResourceIdSchema,
  projectIds: z.array(ProjectIdSchema).min(1), originalProjectIds: z.array(ProjectIdSchema).min(1), backendPid: z.number().int().positive(), callbackPid: z.number().int().positive(),
  callbackStartedAt: z.iso.datetime(), inputDigest: deletionHash, exitKeyDigest: deletionHash, identity: deletionHash,
  process: z.object({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) }).strict(),
  exited: z.boolean(), exitDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), recoveryDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine((entry) =>
  entry.exited === !!entry.exitDigest && (!entry.recoveryDigest || entry.exited) && (!entry.exitDigest || entry.exitDigest === runtimeImageCallbackReceipt(entry, entry.recoveryDigest))
  && new Set(entry.projectIds).size === entry.projectIds.length && new Set(entry.originalProjectIds).size === entry.originalProjectIds.length
  && entry.projectIds.every((id) => entry.originalProjectIds.includes(id)) && jsonHash(entry.originalProjectIds) === jsonHash([...entry.originalProjectIds].sort()), '原运行镜像回调的归属、原进程或退出身份冲突');
export function runtimeImageCallbackReceipt(value: Pick<RuntimeImageCallbackRecord, 'id' | 'kind' | 'consumerId' | 'originalProjectIds' | 'backendPid' | 'callbackPid' | 'callbackStartedAt' | 'inputDigest' | 'exitKeyDigest' | 'process'>, recoveryDigest?: string): string {
  return jsonHash({ id: value.id, kind: value.kind, consumerId: value.consumerId, inputDigest: value.inputDigest, projectIds: value.originalProjectIds,
    backendPid: value.backendPid, callbackPid: value.callbackPid, callbackStartedAt: value.callbackStartedAt, originalProcess: value.process, exitKeyDigest: value.exitKeyDigest, ...(recoveryDigest ? { recoveryDigest } : {}) });
}
export function runtimeImagePhysicalOrigins(projectId: string, resources: ProjectDeletionInventory['resources'], callbacks: readonly RuntimeImageCallbackRecord[]): string {
  return jsonHash({ projectId, resources: resources.filter((entry) => entry.scope === 'physical').sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)),
    callbacks: callbacks.map((entry) => runtimeImageCallbackReceipt(entry)).sort() });
}
/** A coverage statement cannot omit known original consumers or replace their input/process identity. */
export function runtimeImagePhysicalBindings(scope: { projectId: string; originDigest: string; objects: readonly { kind: string; consumerId?: string; consumerIdentity?: string }[] }, projectId: string, resources: ProjectDeletionInventory['resources'], callbacks: readonly RuntimeImageCallbackRecord[]): boolean {
  if (scope.projectId !== projectId || scope.originDigest !== runtimeImagePhysicalOrigins(projectId, resources, callbacks)) return false;
  const bindings = new Map<string, Set<string>>();
  for (const object of scope.objects) if (object.consumerId && object.consumerIdentity) {
    const key = object.kind + ':' + object.consumerId, values = bindings.get(key) ?? new Set<string>(); values.add(object.consumerIdentity); bindings.set(key, values);
  }
  return resources.filter((entry) => entry.scope === 'physical').every((entry) => {
    const kind = entry.kind === 'runtime-image:build' ? 'builder' : entry.kind === 'runtime-image:validation' ? 'validation' : undefined;
    return !!kind && !!bindings.get(kind + ':' + entry.id)?.has(entry.sourceIdentity ?? entry.identity);
  }) && callbacks.every((entry) => bindings.get('callback:' + entry.id)?.has(runtimeImageCallbackReceipt(entry)));
}
export interface ImageReference {
  readonly id: string;
  readonly versionId: string;
  readonly projectId: string;
  readonly ownerType: 'release' | 'task' | 'agent' | 'session' | 'development-config' | 'validation';
  readonly ownerId: string;
  readonly state: 'reserved' | 'confirmed';
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly snapshot?: RuntimeImageExecutionSnapshot;
  readonly snapshotInputDigest?: string;
}
export interface ImageLogChunk { readonly sequence: number; readonly stage: string; readonly text: string; readonly createdAt: string }
export interface DevelopmentImagePolicy extends Omit<SaveDevelopmentRuntimeImages, 'expectedRevision'> { readonly projectId: string; readonly revision: number }

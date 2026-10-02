import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, TaskIdSchema, VolumeModeSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../taskEnvironment';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** One validator for admitted and recovered original material; unknown immutable fields remain in its hash. */
const OriginalDevelopmentParentRenderSchema = z.looseObject({
  image: text, workerUid: revision, resources: z.looseObject({ cpu: text, memory: text, storage: text }), start: revision,
  execution: z.never().optional(), businessStorage: z.never().optional(), runtimeValidation: z.never().optional(), workVolume: z.never().optional(),
  runtimeConnectionDeadline: z.never().optional(), runtimeInitializationDeadline: z.never().optional(),
});
export const DevelopmentParentEndingPhaseSchema = z.enum(['admission-sealed', 'children', 'prepared', 'stop-intent', 'proved', 'complete']);
export const DevelopmentParentEndingPointerSchema = z.strictObject({
  version: z.literal(1), endingId: ResourceIdSchema, epochHash: digest, phase: DevelopmentParentEndingPhaseSchema,
});
export type DevelopmentParentEndingPointer = z.infer<typeof DevelopmentParentEndingPointerSchema>;

/** Pure original identity; physical reads and proofs belong to the dedicated ending worker. */
export const DevelopmentParentEpochSchema = z.strictObject({
  version: z.literal(1), parentId: TaskIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema,
  kind: z.literal('dev-session'), volumeMode: VolumeModeSchema, namespace: text, podName: text, podUid: z.uuid(),
  pvcName: text, pvcUid: z.uuid(), profile: text, labels: z.record(z.string(), z.string()), runnerTokenHash: digest,
  originalRenderStart: revision.nullable(), acceptedRender: OriginalDevelopmentParentRenderSchema.nullable(),
}).superRefine((epoch, ctx) => {
  if (epoch.acceptedRender === null ? epoch.originalRenderStart !== null : epoch.acceptedRender['start'] !== epoch.originalRenderStart)
    ctx.addIssue({ code: 'custom', message: '原 render 有无与原启动代次必须一致' });
});
export type DevelopmentParentEpoch = z.infer<typeof DevelopmentParentEpochSchema>;
type ParentContext = TaskEnvironment & { readonly parentEnding?: unknown };

export function hasDevelopmentParentEnding(env: ParentContext): boolean {
  return Object.prototype.hasOwnProperty.call(env, 'parentEnding');
}
export function readDevelopmentParentEnding(env: ParentContext): DevelopmentParentEndingPointer | undefined {
  if (!hasDevelopmentParentEnding(env)) return undefined;
  const parsed = DevelopmentParentEndingPointerSchema.safeParse(env.parentEnding);
  if (!parsed.success) throw precondition('原开发父任务结束身份无效，等待原受理恢复', { code: 'development_parent_ending_invalid' });
  return parsed.data;
}
/** Includes malformed presence and complete old epochs; only new publication clears the pointer. */
export function assertDevelopmentParentAdmission(env: ParentContext): void {
  if (hasDevelopmentParentEnding(env)) throw precondition('原开发父任务已封存新执行准入', { code: 'development_parent_ending_pending' });
}

function originalRender(env: TaskEnvironment): z.infer<typeof OriginalDevelopmentParentRenderSchema> | null {
  if (!Object.prototype.hasOwnProperty.call(env, 'render')) return null;
  const render = env.render;
  if (!render || typeof render !== 'object')
    throw precondition('原开发父 render 存在但受理材料不完整', { code: 'development_parent_epoch_invalid' });
  const { runtimeConnectionDeadline: _connection, runtimeInitializationDeadline: _initialization, ...accepted } = render;
  const parsed = OriginalDevelopmentParentRenderSchema.safeParse(accepted);
  if (!parsed.success) throw precondition('原开发父 render 存在但受理材料不完整', { code: 'development_parent_epoch_invalid' });
  return JSON.parse(JSON.stringify(parsed.data)) as z.infer<typeof OriginalDevelopmentParentRenderSchema>;
}

/** UID facts must come from the original owner/cluster boundary; this produces no start/stop evidence. */
export function snapshotDevelopmentParentEpoch(env: TaskEnvironment, physical: { readonly podUid: string; readonly pvcUid: string }): DevelopmentParentEpoch {
  if (env.native !== undefined || env.podUid !== undefined && env.podUid !== physical.podUid)
    throw precondition('原开发父实例已变化或不是父环境', { code: 'development_parent_epoch_invalid' });
  const acceptedRender = originalRender(env);
  if (env.render?.rebuild && env.render.rebuild.volumeUid !== physical.pvcUid)
    throw precondition('原开发恢复工作卷实例已变化', { code: 'development_parent_epoch_invalid' });
  return DevelopmentParentEpochSchema.parse({ version: 1, parentId: env.id, projectId: env.projectId, serviceId: env.serviceId, kind: env.kind,
    volumeMode: env.volumeMode, namespace: env.namespace, podName: env.podName, podUid: physical.podUid, pvcName: env.pvcName, pvcUid: physical.pvcUid,
    profile: env.profile, labels: env.labels, runnerTokenHash: env.runnerTokenHash, originalRenderStart: acceptedRender?.['start'] ?? null, acceptedRender });
}
export function developmentParentEpochHash(epoch: DevelopmentParentEpoch): string {
  return jsonHash(DevelopmentParentEpochSchema.parse(epoch));
}
/** Completion/recovery binds the real final Task state without depending on Runner activity or time. */
export function developmentParentTransitionHash(env: ParentContext): string {
  const pointer = readDevelopmentParentEnding(env);
  return jsonHash({ version: 1, id: env.id, projectId: env.projectId, serviceId: env.serviceId, kind: env.kind, state: env.state,
    volumeMode: env.volumeMode, namespace: env.namespace, podName: env.podName, podUid: env.podUid ?? null, pvcName: env.pvcName,
    profile: env.profile, labels: env.labels, runnerTokenHash: env.runnerTokenHash, render: originalRender(env),
    rebuildId: env.rebuildId ?? null, parentEnding: pointer ?? null });
}

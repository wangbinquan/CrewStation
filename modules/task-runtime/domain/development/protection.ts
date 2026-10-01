import { z } from 'zod';
import type { WorkloadConsumerIntent } from '@crewstation/contracts';
import { DevelopmentUsageStorageSchema, DevelopmentRemovalProtectionSchema, ProjectIdSchema, ResourceIdSchema, TaskIdSchema, WorkloadConsumerIntentSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../taskEnvironment';

export interface DevelopmentWorkloadProtection {
  readonly developmentUsageProtection: { readonly version: 1 };
  readonly developmentRemovalProtection?: { readonly version: 1 };
  readonly consumer: WorkloadConsumerIntent;
  readonly expectedVolumeUid: string;
}
const uid = z.uuid();
const text = (value: unknown) => typeof value === 'string' && value.length > 0;

/** Original immutable selection only: no registration, cluster lookup, drain, physical-stop or zero-usage proof. */
export function developmentWorkloadProtection(env: TaskEnvironment): DevelopmentWorkloadProtection | undefined {
  const render = env.render;
  if (render?.developmentRemovalProtection !== undefined && (render.developmentUsageProtection === undefined || !DevelopmentRemovalProtectionSchema.safeParse(render.developmentRemovalProtection).success)) throw precondition('原准入回执选择缺原工作卷保护或版本无效');
  if (render?.developmentUsageProtection === undefined) return undefined;
  const n = env.native, flag = DevelopmentUsageStorageSchema.safeParse(render.developmentUsageProtection);
  const layout = DevelopmentUsageStorageSchema.safeParse(render.developmentUsageStorage);
  if (!flag.success || !layout.success || env.kind !== 'dev-session' || n?.purpose !== 'agent' || n.terminalId !== undefined
    || env.businessWorkspace !== undefined || env.rebuildId !== undefined || render.rebuild !== undefined
    || render.businessStorage !== undefined || render.completionPolicy !== undefined || render.checkout !== undefined || render.workVolume !== undefined
    || !TaskIdSchema.safeParse(env.id).success || !ProjectIdSchema.safeParse(env.projectId).success || !TaskIdSchema.safeParse(n.parentTaskId).success || env.id === n.parentTaskId
    || !ResourceIdSchema.safeParse(n.agentId).success || !ResourceIdSchema.safeParse(n.profile.id).success || !ResourceIdSchema.safeParse(n.computeProfile?.profileId).success
    || !Number.isSafeInteger(n.computeProfile?.revision) || n.computeProfile!.revision <= 0 || !uid.safeParse(n.parentPodUid).success || !uid.safeParse(n.pvcUid).success
    || !text(n.nodeName) || !text(env.pvcName) || !text(env.podName) || !text(env.namespace) || !text(n.image) || n.image !== render.image
    || !Number.isSafeInteger(render.workerUid) || render.workerUid <= 0 || !['cpu', 'memory', 'storage'].every((key) => text(render.resources[key as keyof typeof render.resources]) && render.resources[key as keyof typeof render.resources] === n.profile[key as keyof typeof render.resources])
    || render.execution !== undefined && (!text(render.execution.workspacePod) || render.execution.creator !== undefined && render.execution.creator !== 'native')
    || render.developmentUsageRequestHash !== undefined && !/^[0-9a-f]{64}$/.test(render.developmentUsageRequestHash)
    || env.podUid !== undefined && !uid.safeParse(env.podUid).success || n.podUid !== undefined && !uid.safeParse(n.podUid).success
    || env.podUid !== undefined && n.podUid !== undefined && env.podUid !== n.podUid) throw precondition('独立开发 Agent 的原工作卷保护快照不完整或冲突');
  const consumer = WorkloadConsumerIntentSchema.safeParse({ id: render.workloadConsumerId, taskId: n.parentTaskId, revision: render.start, purpose: 'agent', finalization: null });
  if (!consumer.success) throw precondition('独立开发 Agent 的原消费者和启动修订不完整');
  return { developmentUsageProtection: flag.data, ...(render.developmentRemovalProtection !== undefined ? { developmentRemovalProtection: DevelopmentRemovalProtectionSchema.parse(render.developmentRemovalProtection) } : {}), consumer: consumer.data, expectedVolumeUid: n.pvcUid };
}

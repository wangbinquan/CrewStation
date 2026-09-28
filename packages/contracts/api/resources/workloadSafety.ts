import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';
import type { ProjectId, ServiceId, TaskId } from '../../ids';

export const WORKLOAD_STOP_FINALIZER = 'crewstation.io/workload-stop-proof';
export const WORKLOAD_CONSUMER_ANNOTATION = 'crewstation.io/workload-consumer';
export const WorkloadConsumerIntentSchema = z.strictObject({
  id: ResourceIdSchema, taskId: TaskIdSchema, revision: z.number().int().positive(), purpose: z.enum(['business', 'agent', 'archive']),
  finalization: z.strictObject({ operationId: ResourceIdSchema, revision: z.number().int().positive() }).nullable(),
}).refine((input) => (input.purpose === 'archive') === (input.finalization !== null), '归档消费者必须绑定终结操作');
export type WorkloadConsumerIntent = z.infer<typeof WorkloadConsumerIntentSchema>;
export const WorkloadAdmissionIdentitySchema = z.strictObject({ consumer: WorkloadConsumerIntentSchema, resourceId: ResourceIdSchema, namespace: z.string().min(1).max(253), podName: z.string().min(1).max(253) });
export type WorkloadAdmissionIdentity = z.infer<typeof WorkloadAdmissionIdentitySchema>;
export const WorkloadConsumerSchema = z.strictObject({
  id: ResourceIdSchema, resourceId: ResourceIdSchema, taskId: TaskIdSchema, revision: z.number().int().positive(),
  namespace: z.string().min(1).max(253), podName: z.string().min(1).max(253), volumeUid: z.uuid(),
  purpose: z.enum(['business', 'agent', 'archive']),
  finalization: z.strictObject({ operationId: ResourceIdSchema, revision: z.number().int().positive() }).nullable(),
}).refine((input) => (input.purpose === 'archive') === (input.finalization !== null), '归档消费者必须绑定终结操作');
export const WorkloadStartPermitSchema = z.strictObject({ podUid: z.uuid(), nodeName: z.string().min(1), nodeUid: z.uuid(), grantedAt: z.iso.datetime() });
export const ContainerStopEvidenceSchema = z.strictObject({
  kind: z.enum(['init', 'container', 'ephemeral']), name: z.string().min(1),
  state: z.enum(['terminated', 'never-started']), containerId: z.string().nullable(), exitCode: z.number().int().nullable(),
});
export const WorkloadStopProofSchema = z.strictObject({
  id: ResourceIdSchema, consumer: WorkloadConsumerSchema, podUid: z.uuid(),
  type: z.enum(['never-scheduled', 'kubelet-terminated']), nodeName: z.string().nullable(), nodeUid: z.uuid().nullable(),
  podResourceVersion: z.string().min(1), observedAt: z.iso.datetime(),
  containers: z.array(ContainerStopEvidenceSchema).min(1).max(256),
}).superRefine((proof, ctx) => {
  const scheduled = proof.type === 'kubelet-terminated';
  if (scheduled !== (proof.nodeName !== null && proof.nodeUid !== null) || (!scheduled && (proof.nodeName !== null || proof.nodeUid !== null))) ctx.addIssue({ code: 'custom', message: '停止证明的节点身份不完整' });
  if (new Set(proof.containers.map((c) => c.name)).size !== proof.containers.length) ctx.addIssue({ code: 'custom', message: '停止证明有重复容器' });
  for (const c of proof.containers) {
    if (!scheduled && c.state !== 'never-started') ctx.addIssue({ code: 'custom', message: '未调度 Pod 不能有已运行容器' });
    if (c.state === 'terminated' && (c.exitCode === null || !c.containerId)) ctx.addIssue({ code: 'custom', message: '退出容器缺少实例或退出码' });
    if (c.state === 'never-started' && (c.exitCode !== null || c.containerId !== null)) ctx.addIssue({ code: 'custom', message: '未启动容器不能带运行实例' });
  }
});
export type WorkloadConsumer = z.infer<typeof WorkloadConsumerSchema>;
export type WorkloadStartPermit = z.infer<typeof WorkloadStartPermitSchema>;
export type ContainerStopEvidence = z.infer<typeof ContainerStopEvidenceSchema>;
export type WorkloadStopProof = z.infer<typeof WorkloadStopProofSchema>;
/** A durable bounded scan; absence of a Pod is deliberately not an allowed proof. */
export interface WorkloadStopBarrier {
  readonly state: 'pending' | 'blocked' | 'complete';
  readonly count: number;
  readonly digest: string | null;
  readonly blockedConsumerId: string | null;
}
export interface WorkloadFinalizationFence { readonly operationId: string; readonly revision: number }
export interface BusinessStorageFinalization extends WorkloadFinalizationFence {
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly taskId: TaskId;
  readonly volumeUid: string | null;
}

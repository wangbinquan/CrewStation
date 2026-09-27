import type { CreateBusinessTaskV3, ProjectId, ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { TraceIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, newTraceId, precondition, validation } from '@crewstation/kernel';
import type { ContractRegistration } from '../domain/contractRegistry';
import type { OperationCandidate } from '../domain/taskAdmission';

/** 调用方身份和 release 必须先由可信源 Pod 解析；本用例不接受客户端自报的发布身份。 */
export interface TaskAdmissionSource { serviceId: ServiceId; projectId: ProjectId; identity: string; project: string; service: string; epoch: number | null }

export function taskRequestDigest(input: CreateBusinessTaskV3): string {
  const { requestKey: _key, fence: _fence, traceId: _trace, ...parameters } = input;
  return jsonHash(parameters);
}

export function admissionTrace(body: TraceId | undefined, header: string | undefined): TraceId {
  if (header !== undefined && !TraceIdSchema.safeParse(header).success) throw validation('x-cs-trace-id 必须是 32 位十六进制');
  if (header && body && header !== body) throw validation('请求体和 x-cs-trace-id 不一致');
  return body ?? (header as TraceId | undefined) ?? (newTraceId() as TraceId);
}

/** 只在幂等回执不存在时构造；重放必须先比较 requestDigest，不能重新套用最新 defaults。 */
export function taskAdmissionCandidate(source: TaskAdmissionSource, registration: ContractRegistration, input: CreateBusinessTaskV3, traceId: TraceId, now: Date): OperationCandidate {
  const spec = registration.tasksSpec;
  if (registration.serviceId !== source.serviceId || !spec) throw precondition('发布缺少完整任务契约', { code: 'release_contract_missing' });
  if (spec.acceptedTaskContractVersions && !spec.acceptedTaskContractVersions.includes(input.taskContractVersion)) throw precondition('发布不支持此任务契约版本', { code: 'task_contract_unsupported' });
  if (Object.keys(input.labels).some((key) => key.startsWith('crewstation.io/'))) throw validation('任务标签不能覆盖平台身份');
  const taskId = newResourceId() as TaskId, contractDigest = jsonHash(registration.releaseMaterials ? { spec, releaseMaterials: registration.releaseMaterials } : spec);
  const task: OperationCandidate['intent']['task'] = {
    id: taskId, serviceId: source.serviceId, releaseId: registration.releaseId, state: 'admitting', generation: 1,
    taskContractVersion: input.taskContractVersion, contractDigest, volumeMode: input.volumeMode ?? spec.defaultVolumeMode,
    taskProfileId: input.taskProfileId ?? spec.taskProfileId, labels: input.labels, traceId,
    volumeUid: null, resourceState: 'admitting', quotaHeld: false, createdAt: now.toISOString(),
  };
  const requestDigest = taskRequestDigest(input);
  return {
    id: newResourceId(), serviceId: source.serviceId, kind: 'create-task', parentId: '', requestKey: input.requestKey,
    requestDigest, effectiveDigest: jsonHash({ requestDigest, releaseId: registration.releaseId, contractDigest, volumeMode: task.volumeMode, taskProfileId: task.taskProfileId }), epoch: source.epoch,
    intent: { kind: 'create-task', projectId: source.projectId, callerIdentity: source.identity, task, tasksSpec: spec, ...(registration.releaseMaterials ? { releaseMaterials: registration.releaseMaterials } : {}),
      environmentLabels: { ...input.labels, 'crewstation.io/project': source.project, 'crewstation.io/service': source.service } },
  };
}

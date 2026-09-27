import { requireBusinessAgent } from './capabilities';
import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import type { BusinessSubtaskV3Dto, ServiceId, TaskId, SubmitBusinessSubtaskV3 } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import type { BusinessExecutionDeps } from './dependencies';
import { agentCommand, agentPayloadDigest } from './agentMaterial';

/** I34: fresh means a new native home, while the admitted environment and materials stay pinned. */
export async function prepareAgentFreshRetry(deps: BusinessExecutionDeps, source: ExecutionSubtask, original: ExecutionAgentPlan, view: BusinessSubtaskV3Dto, runtimeTaskId: TaskId, input: Extract<SubmitBusinessSubtaskV3, { kind: 'agent' }>) {
  const env = await deps.environments.getEnvironment(view.taskId);
  if (original.kind !== 'agent-plan' || env?.projectId !== original.projectId || !original.volumeUid || original.volumeUid !== env.businessWorkspace?.volumeUid) throw conflict('原执行快照或工作区卷身份不可用', { code: 'session_incompatible' });
  requireBusinessAgent(original.compute);
  const { resumeSessionId: _resume, ...command } = original.command;
  const plan: ExecutionAgentPlan = { ...original, request: input, sessionKey: runtimeTaskId, nonce: randomBytes(32).toString('hex'), command: {
    ...command, id: view.executionId, agentId: view.executionId, processAttemptId: view.executionId,
  } };
  const payloadDigest = agentPayloadDigest(await agentCommand(deps, plan), plan.nonce);
  if (original.runtimeImage) {
    if (!deps.runtimeImages?.restoreAgent || !source.runtimeTaskId) throw precondition('原执行运行镜像引用不可恢复', { code: 'unsupported_capability' });
    await deps.runtimeImages.restoreAgent(original.projectId, original.runtimeImage, source.runtimeTaskId, runtimeTaskId);
  }
  return { plan, payloadDigest, view: { ...view, image: original.runtimeImage?.image ?? original.compute.image,
    agentProfileId: source.view.agentProfileId, computeProfileId: original.compute.id, profileRevision: original.compute.revision,
    materialDigest: source.view.materialDigest, runtimeImage: original.runtimeImage } };
}

/** Resume inherits the original execution snapshot; current project defaults cannot replace it. */
export async function prepareAgentResume(deps: BusinessExecutionDeps, serviceId: ServiceId, view: BusinessSubtaskV3Dto, volumeUid: string, runtimeTaskId: TaskId, input: Extract<SubmitBusinessSubtaskV3, { kind: 'agent' }>) {
  const session = await deps.sessions.get(serviceId, view.taskId, input.resumeSessionId!);
  if (!session) throw notFound('父任务原生会话', input.resumeSessionId!);
  if (session.volumeUid !== volumeUid) throw conflict('原会话卷身份已变化', { code: 'session_incompatible' });
  if (session.state !== 'idle' || session.leaseExecutionId) throw conflict('原会话执行资源尚未停止', { code: 'session_in_use' });
  const source = await deps.subtasks.forExecution(serviceId, view.taskId, session.sourceExecutionId);
  if (!source || !source.runtimeReleased) throw conflict('原会话资源释放尚未确认', { code: 'session_in_use' });
  const original = JSON.parse(await deps.cipher.open(source.sealedPayload)) as ExecutionAgentPlan;
  if (original.kind !== 'agent-plan' || original.sessionKey !== session.sessionKey || original.volumeUid !== volumeUid) throw conflict('原会话执行快照不可用', { code: 'session_incompatible' });
  if (!requireBusinessAgent(original.compute).resume) throw precondition('固定档位修订不支持会话恢复', { code: 'unsupported_capability', capability: 'resume' });
  const sameCwd = posix.resolve('/work', input.cwd ?? '.') === posix.resolve('/work', original.request.cwd ?? '.');
  if (input.agentProfileId !== original.request.agentProfileId || input.mode !== original.request.mode || !sameCwd || input.outputContractId !== original.request.outputContractId) throw conflict('续跑不能改变原会话档案、模式、目录或输出契约', { code: 'session_incompatible' });
  if (input.runtimeImageVersionId && input.runtimeImageVersionId !== original.runtimeImage?.versionId) throw conflict('续跑不能改变原会话运行镜像', { code: 'session_incompatible' });
  if (input.materialId) {
    const material = await deps.materials.get(serviceId, view.taskId, input.materialId);
    if (!material || material.view.digest !== source.view.materialDigest) throw conflict('续跑不能改变原会话材料', { code: 'session_incompatible' });
  }
  const plan: ExecutionAgentPlan = { ...original, request: { ...input, materialId: original.request.materialId }, nonce: randomBytes(32).toString('hex'), command: {
    ...original.command, id: view.executionId, agentId: view.executionId, processAttemptId: view.executionId, initialPrompt: input.prompt, resumeSessionId: input.resumeSessionId,
  } };
  const payloadDigest = agentPayloadDigest(await agentCommand(deps, plan), plan.nonce);
  if (original.runtimeImage) {
    if (!deps.runtimeImages?.restoreAgent || !source.runtimeTaskId) throw precondition('原会话运行镜像引用不可恢复', { code: 'unsupported_capability' });
    await deps.runtimeImages.restoreAgent(original.projectId, original.runtimeImage, source.runtimeTaskId, runtimeTaskId);
  }
  return { plan, payloadDigest, view: { ...view, image: source.view.image, agentProfileId: source.view.agentProfileId,
    computeProfileId: source.view.computeProfileId, profileRevision: source.view.profileRevision, materialDigest: source.view.materialDigest, runtimeImage: source.view.runtimeImage } };
}

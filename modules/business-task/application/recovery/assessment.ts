import type { BusinessRecoveryAssessment, ServiceId, SubtaskId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { liveControl } from '../../domain/executionControl';
import { recoveryAssessment } from '../../domain/taskRecovery';
import type { ExecutionOperation } from '../../domain/taskAdmission';
import type { RecoveryQueries } from '../../ports/taskRecovery';
import { admissionTaskView } from '../execution/taskView';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { recoveryMaterialProof } from './materialProof';

export async function assessRecovery(deps: BusinessExecutionDeps, queries: RecoveryQueries, parent: ExecutionOperation, subtaskId?: SubtaskId): Promise<{ assessment: BusinessRecoveryAssessment; epoch: number }> {
  const taskId = parent.intent.task.id, { control, now } = await deps.controls.read(parent.serviceId);
  const registration = control?.activeReleaseId ? await deps.uow.read.contracts.forRelease(parent.serviceId as ServiceId, control.activeReleaseId) : undefined;
  const capability = registration?.tasksSpec?.recovery?.actions ?? [], epoch = control?.epoch ?? 0;
  const children = await deps.subtasks.list(parent.serviceId, taskId), child = children.find((c) => c.view.id === subtaskId);
  if (subtaskId && !child) throw notFound('业务子任务', subtaskId);
  const reasons: string[] = [];
  if (!capability.length) reasons.push('application_recovery_unsupported');
  if (!control || control.phase !== 'active' || !liveControl(control, now) || (control.handoff && control.handoff.stage !== 'complete')) reasons.push('application_controller_offline');
  if (reasons.length) return { epoch, assessment: { taskId, actions: [], reasons } };
  let workspace;
  try { workspace = await deps.environments.inspectBusinessRecovery?.({ projectId: parent.intent.projectId, serviceId: parent.serviceId as ServiceId, taskId }); } catch { /* An unavailable observer supplies no positive resource proof. */ }
  if (!workspace) return { epoch, assessment: { taskId, actions: [], reasons: ['resource_observation_unavailable'] } };
  const task = await admissionTaskView(deps, parent), lifecycle = await deps.lifecycles.read(parent.serviceId, taskId);
  const stopped = await Promise.all(children.map((c) => queries.childStopped(parent.serviceId, taskId, c.view.id)));
  const activeChildren = workspace.activeChildren || children.some((c, i) => !['succeeded', 'failed', 'cancelled'].includes(c.view.state) || !stopped[i]);
  const operationPending = Boolean(lifecycle?.operationId) || ['pending', 'running'].includes(parent.state) || await deps.recoveryRequests!.hasActive(parent.serviceId, taskId, subtaskId);
  const material = await recoveryMaterialProof(deps, parent, workspace, child);
  return { epoch, assessment: recoveryAssessment({
    taskId, generation: task.generation, materialDigest: parent.effectiveDigest, state: workspace.state === task.state ? task.state : 'unknown', capability,
    controllerOnline: true, controlEpoch: epoch, persistent: workspace.persistent, volumeUid: workspace.volumeUid, volumeVerified: workspace.volumeVerified,
    stopped: workspace.stopped, activeChildren, operationPending, imageCompatible: material.imageCompatible,
    ...(child ? { child: { id: child.view.id, attempt: child.view.attempt, materialDigest: child.payloadDigest, state: child.view.state, process: child.view.process,
      stopped: stopped[children.indexOf(child)]!, hasSuccessor: children.some((c) => c.requestKind === 'retry' && c.requestParent === child.view.id), sessionId: child.view.sessionId, sessionCompatible: material.sessionCompatible } } : {}),
  }) };
}

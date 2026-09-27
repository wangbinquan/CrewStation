import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import type { ExecutionOperation } from '../../domain/taskAdmission';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { testedAgentCapabilities } from '../execution/capabilities';
import type { Environments } from '../../ports/runtime';
import { jsonHash } from '@crewstation/kernel';

type Workspace = NonNullable<Awaited<ReturnType<NonNullable<Environments['inspectBusinessRecovery']>>>>;
/** Read the retained snapshot and native session; never reserve images or resolve current defaults. */
export async function recoveryMaterialProof(deps: BusinessExecutionDeps, parent: ExecutionOperation, workspace: Workspace, child?: ExecutionSubtask) {
  const task = parent.intent.task, image = task.runtimeImage;
  let imageCompatible = Boolean(workspace.image) && (!task.image || task.image === workspace.image);
  if (image) {
    try { imageCompatible = imageCompatible && workspace.image === image.image && Boolean(workspace.runtimeImage) && jsonHash(image) === jsonHash(workspace.runtimeImage) && Boolean(await deps.runtimeImages?.inspectReference?.(parent.intent.projectId, { type: 'task', id: task.id }, image)); }
    catch { imageCompatible = false; }
  }
  if (!child || child.view.kind !== 'agent') return { imageCompatible, sessionCompatible: false };
  try {
    const original = JSON.parse(await deps.cipher.open(child.sealedPayload)) as ExecutionAgentPlan;
    if (original.kind !== 'agent-plan' || original.projectId !== parent.intent.projectId || original.volumeUid !== workspace.volumeUid || !workspace.volumeVerified) return { imageCompatible: false, sessionCompatible: false };
    const capability = testedAgentCapabilities(original.compute);
    imageCompatible = imageCompatible && capability.events && Boolean(child.view.image) && child.view.image === (original.runtimeImage?.image ?? original.compute.image);
    if (original.runtimeImage) imageCompatible = imageCompatible && Boolean(child.runtimeTaskId && await deps.runtimeImages?.inspectReference?.(parent.intent.projectId, { type: 'agent', id: child.runtimeTaskId }, original.runtimeImage));
    const session = child.view.sessionId ? await deps.sessions.get(parent.serviceId, task.id, child.view.sessionId) : undefined;
    const sessionCompatible = Boolean(imageCompatible && capability.resume && child.runtimeReleased && session?.state === 'idle' && !session.leaseExecutionId
      && session.sourceExecutionId === child.view.executionId && session.volumeUid === workspace.volumeUid && session.sessionKey === original.sessionKey);
    return { imageCompatible, sessionCompatible };
  } catch { return { imageCompatible: false, sessionCompatible: false }; }
}

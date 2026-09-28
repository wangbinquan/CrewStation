import type { RuntimeImageExecutionSnapshot, RuntimeImageSelection, TaskId } from '@crewstation/contracts';
import { isPlatformError, jsonHash, precondition } from '@crewstation/kernel';
import type { OperationCandidate } from '../domain/taskAdmission';
import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import type { ExecutionLifecycle } from '../domain/executionLifecycle';
import type { BusinessExecutionDeps } from './execution/dependencies';

/** A returned winner or an explicit transaction rejection proves this candidate cannot be dispatched. */
export async function admitWithRuntimeImage<T>(images: Pick<BusinessRuntimeImages, 'release'> | undefined, snapshot: RuntimeImageExecutionSnapshot | undefined, owner: { type: 'task' | 'agent'; id: TaskId }, admit: () => Promise<T>, admittedOwner: (result: T) => string | null | undefined, prepare?: () => Promise<void>): Promise<T> {
  const release = async () => {
    if (!snapshot) return;
    if (!images?.release) throw new Error('未采用的镜像预留缺少释放端口');
    await images.release(snapshot, owner);
  };
  // Preparation runs before business admission. Even a lost preparation reply
  // proves reserve was never called, so its unused runtime image can be released.
  try { await prepare?.(); } catch (error) { await release(); throw error; }
  let result: T;
  try { result = await admit(); }
  catch (error) {
    // Transport/commit ambiguity is not proof of rollback: retain its image for recovery.
    if (isPlatformError(error) && ['conflict', 'validation', 'forbidden', 'not_found', 'precondition', 'quota_exceeded'].includes(error.kind)) await release();
    throw error;
  }
  if (admittedOwner(result) !== owner.id) await release();
  return result;
}

/** 幂等重放不再选择；原请求指纹和最终镜像快照分别持久化。 */
export async function bindTaskRuntimeImage(candidate: OperationCandidate, images: BusinessRuntimeImages | undefined, requestedVersionId?: string): Promise<OperationCandidate> {
  const spec = candidate.intent.tasksSpec;
  const selection: RuntimeImageSelection = { ...(spec.runtimeImageVersionId ? { runtimeImageVersionId: spec.runtimeImageVersionId } : {}), ...(spec.allowedRuntimeImageVersionIds ? { allowedRuntimeImageVersionIds: spec.allowedRuntimeImageVersionIds } : {}) };
  if (!requestedVersionId && !selection.runtimeImageVersionId) return candidate;
  if (!images) throw precondition('平台尚未配置业务任务运行镜像能力', { code: 'unsupported_capability' });
  const snapshot = await images.reserveTask(candidate.intent.projectId, candidate.intent.task.id, selection, requestedVersionId);
  if (!snapshot) throw precondition('显式任务运行镜像未解析', { code: 'runtime_image_missing' });
  return { ...candidate, effectiveDigest: jsonHash({ admission: candidate.effectiveDigest, runtimeImage: snapshot }), intent: { ...candidate.intent, task: { ...candidate.intent.task, runtimeImage: snapshot } } };
}

/** Called only after physical parent closure, while its durable close operation still blocks admission. */
export async function releaseClosedTaskImages(deps: BusinessExecutionDeps, operation: ExecutionLifecycle): Promise<boolean> {
  const parent = await deps.operations.forTask(operation.serviceId, operation.taskId);
  if (!parent) throw new Error('关闭任务的原始镜像快照不可用');
  const children = await deps.subtasks.list(operation.serviceId, operation.taskId);
  const images = children.filter((child) => child.view.runtimeImage);
  if (images.some((child) => !child.runtimeTaskId || !child.runtimeReleased)) return false;
  if (!parent.intent.task.runtimeImage && !images.length) return true;
  if (!deps.runtimeImages?.release) throw new Error('关闭任务的镜像引用释放端口不可用');
  for (const child of images) await deps.runtimeImages.release(child.view.runtimeImage!, { type: 'agent', id: child.runtimeTaskId! });
  if (parent.intent.task.runtimeImage) await deps.runtimeImages.release(parent.intent.task.runtimeImage, { type: 'task', id: operation.taskId });
  return true;
}

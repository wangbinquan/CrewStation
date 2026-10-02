import { jsonHash, precondition } from '@crewstation/kernel';
import { assertDevelopmentParentAdmission, hasDevelopmentParentEnding, readDevelopmentParentEnding } from '../../../domain/development/parentEnding';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { RepositoryScope } from '../../../ports/unitOfWork';

export interface DevelopmentWriterWitness { readonly parentId: string; readonly hash: string; readonly diagnosticConnection?: true }
type WriterOperation = 'mutation' | 'existing-legacy-connection';
function witness(parent: TaskEnvironment): DevelopmentWriterWitness {
  const render = parent.render;
  const accepted = render ? Object.fromEntries(Object.entries(render).filter(([key]) => !['runtimeConnectionDeadline', 'runtimeInitializationDeadline'].includes(key))) : null;
  return { parentId: parent.id, hash: jsonHash({ id: parent.id, projectId: parent.projectId, serviceId: parent.serviceId, kind: parent.kind,
    volumeMode: parent.volumeMode, namespace: parent.namespace, podName: parent.podName, podUid: parent.podUid ?? null, pvcName: parent.pvcName,
    profile: parent.profile, labels: parent.labels, runnerTokenHash: parent.runnerTokenHash, rebuildId: parent.rebuildId ?? null, render: accepted }) };
}
/** The original running legacy CLI can reconnect diagnostically after its parent was rebuilt. */
async function existingLegacyConnection(scope: RepositoryScope, environment: TaskEnvironment, expected: DevelopmentWriterWitness | undefined, operation: WriterOperation): Promise<boolean> {
  const native = environment.native;
  if (operation !== 'existing-legacy-connection' || expected || environment.state !== 'running' || native?.state !== 'running'
    || native.purpose !== undefined && native.purpose !== 'cli' || typeof native.podUid !== 'string' || !native.podUid
    || environment.podUid !== undefined && environment.podUid !== native.podUid) return false;
  const original = await scope.environments.getMaintenanceView?.(environment.id);
  if (original?.status !== 'present' || jsonHash(original.environment) !== jsonHash(environment))
    throw precondition('原 CLI 连接受理材料无效，等待原身份恢复');
  const child = original.environment, render = child.render;
  return !Object.hasOwn(child, 'parentEnding') && !['developmentCleanup', 'developmentRemovalSeal'].some((key) => Object.hasOwn(child.native!, key))
    && !(render && (['developmentUsageStorage', 'developmentUsageProtection', 'developmentRemovalProtection', 'developmentUsageRequestHash'].some((key) => Object.hasOwn(render, key))
      || render.rebuild && Object.hasOwn(render.rebuild, 'developmentParentSelection')));
}
/** Capture before external preparation and verify again under the original Project lock, including after a completed epoch was replaced. */
export async function assertDevelopmentWriter(scope: RepositoryScope, environment: TaskEnvironment, expected?: DevelopmentWriterWitness, operation: WriterOperation = 'mutation'): Promise<DevelopmentWriterWitness | undefined> {
  let parent = environment.native ? await scope.environments.getById(environment.native.parentTaskId) : environment;
  if (!parent || environment.native && (parent.native || parent.projectId !== environment.projectId))
    throw precondition('原执行父任务身份已变化', { code: 'development_parent_changed' });
  if (parent.kind !== 'dev-session') return undefined;
  if (scope.environments.getMaintenanceView) {
    const original = await scope.environments.getMaintenanceView(parent.id);
    if (original?.status !== 'present') throw precondition('原开发父任务受理材料无效，等待原身份恢复');
    parent = original.environment;
  }
  assertDevelopmentParentAdmission(parent);
  const changedParent = !!environment.native && !!parent.podUid && parent.podUid !== environment.native.parentPodUid;
  const diagnosticConnection = changedParent && await existingLegacyConnection(scope, environment, expected, operation);
  if (changedParent && !diagnosticConnection)
    throw precondition('原开发父工作区实例已变化', { code: 'development_parent_changed' });
  const current = witness(parent);
  if (expected && (expected.parentId !== current.parentId || expected.hash !== current.hash))
    throw precondition('原开发父工作区受理材料已变化', { code: 'development_parent_changed' });
  return diagnosticConnection ? { ...current, diagnosticConnection: true } : current;
}
/** The original bound Runner may report diagnostics, but cannot publish fresh render, hash, UID or quota. */
export async function wakeDevelopmentParentEnding(scope: RepositoryScope, environment: TaskEnvironment): Promise<boolean> {
  if (!hasDevelopmentParentEnding(environment)) return false;
  const pointer = readDevelopmentParentEnding(environment);
  if (!pointer || !scope.parentEnding) throw precondition('原父结束持久恢复能力未装配');
  const ending = await scope.parentEnding.endings.get(pointer.endingId);
  if (!ending || ending.parentId !== environment.id || ending.projectId !== environment.projectId || ending.epochHash !== pointer.epochHash || ending.phase !== pointer.phase)
    throw precondition('原父结束受理尚未恢复', { code: 'development_parent_ending_invalid' });
  if (ending.phase !== 'complete') await scope.parentEnding.queue.enqueue(ending.id);
  return true;
}

/** Selected child callbacks only wake their own original parent epoch and keep all execution state unchanged. */
export async function wakeRelatedDevelopmentParentEnding(scope: RepositoryScope, environment: TaskEnvironment): Promise<boolean> {
  if (!environment.native) return wakeDevelopmentParentEnding(scope, environment);
  const parent = await scope.environments.getById(environment.native.parentTaskId);
  if (!parent || parent.kind !== 'dev-session' || parent.native || parent.projectId !== environment.projectId) return false;
  return wakeDevelopmentParentEnding(scope, parent);
}

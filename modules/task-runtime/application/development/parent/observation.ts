import { WorkloadStartPermitSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentParentMaterialsSchema, developmentParentConsumer, preparedDevelopmentParent, requireDevelopmentParentStop } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { advanceDevelopmentParent, withDevelopmentParent } from './current';

export async function prepareDevelopmentParentObservation(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease): Promise<void> {
  const original = await deps.uow.read.parentEnding?.endings.get(id), physical = deps.developmentParentPhysical;
  if (!original || original.phase !== 'children' || !physical) throw precondition('原父物理观察能力尚未装配');
  const materials = DevelopmentParentMaterialsSchema.parse(await physical.inspect(original)), prepared = preparedDevelopmentParent(original, materials);
  await withDevelopmentParent(deps, id, identity, async (scope, environment, ending) => {
    if (ending.phase !== 'children' || await scope.parentEnding!.children.remaining(id) || await scope.parentEnding!.children.liveUnfinished(id)) throw precondition('原固定成员尚未全部闭合');
    const summary = await scope.parentEnding!.children.summary(id);
    if (summary.count !== ending.memberCount || summary.closed !== summary.count) throw precondition('原完整固定成员集合不符');
    await scope.parentEnding!.objects.insert({ endingId: id, kind: 'Pod', namespace: materials.namespace, name: materials.pod.name,
      uid: materials.pod.uid, materialsHash: prepared.materialsHash });
    for (const secret of materials.secrets.filter((s) => s.owned)) await scope.parentEnding!.objects.insert({ endingId: id, kind: 'Secret', namespace: materials.namespace,
      name: secret.name, uid: secret.uid, materialsHash: prepared.materialsHash });
    const now = deps.clock.now();
    await advanceDevelopmentParent(scope, environment, ending, { ...ending, phase: 'prepared', status: 'pending',
      progress: { ...ending.progress, materials, prepared }, message: '等待原父独立观察 Start ACK', retryAt: now }, now);
  });
}
export async function acknowledgeDevelopmentParentObservation(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease): Promise<void> {
  const original = await deps.uow.read.parentEnding?.endings.get(id), physical = deps.developmentParentPhysical, safety = deps.workloadSafety;
  if (!original || original.phase !== 'prepared' || !physical || !safety?.register || !safety.grantStart || !safety.closeConsumer) throw precondition('原父观察持久 ACK 能力尚未装配');
  const materials = DevelopmentParentMaterialsSchema.parse(original.progress['materials']), prepared = preparedDevelopmentParent(original, materials), expected = developmentParentConsumer(original, materials);
  const current = () => withDevelopmentParent(deps, id, identity, async (_scope, _environment, ending) => {
    if (ending.phase !== 'prepared' || jsonHash(ending.progress['materials']) !== jsonHash(materials)) throw precondition('原父观察受理已变化');
  });
  await current(); const registered = await safety.register(expected);
  if (jsonHash(registered.consumer) !== jsonHash(expected)) throw precondition('原父消费者登记身份不符');
  await current(); await physical.fence(original, materials, current);
  let state = await safety.get(id);
  if (!state?.startPermit) { await current(); await safety.grantStart(id, { podUid: prepared.podUid, nodeName: prepared.nodeName, nodeUid: prepared.nodeUid }); state = await safety.get(id); }
  const start = WorkloadStartPermitSchema.parse(state?.startPermit);
  if (start.podUid !== prepared.podUid || start.nodeName !== prepared.nodeName || start.nodeUid !== prepared.nodeUid) throw precondition('原父 Start ACK 的 Pod/Node 实例不符');
  await current(); await safety.closeConsumer(id);
  await safety.closeAdmission({ consumer: prepared.consumer, resourceId: original.parentId, namespace: materials.namespace, podName: materials.pod.name });
  state = await safety.get(id);
  if (!state?.admissionClosed || !await safety.admissionClosed(id)) throw precondition('原父观察关闭尚未持久 ACK');
  await withDevelopmentParent(deps, id, identity, async (scope, environment, ending) => {
    if (ending.phase !== 'prepared' || jsonHash(ending.progress['materials']) !== jsonHash(materials)) throw precondition('原父停止意图身份已变化');
    const now = deps.clock.now();
    await advanceDevelopmentParent(scope, environment, ending, { ...ending, phase: 'stop-intent', status: 'pending',
      message: '原观察 Start 已确认，等待原父全部容器停止', retryAt: now }, now);
  });
}
export async function proveDevelopmentParentObservation(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease): Promise<void> {
  const original = await deps.uow.read.parentEnding?.endings.get(id), physical = deps.developmentParentPhysical, safety = deps.workloadSafety;
  if (!original || original.phase !== 'stop-intent' || !physical || !safety) throw precondition('原父独立停止来源未装配');
  const materials = DevelopmentParentMaterialsSchema.parse(original.progress['materials']);
  const current = () => withDevelopmentParent(deps, id, identity, async (_scope, _environment, ending) => {
    if (ending.phase !== 'stop-intent' || jsonHash(ending.progress['materials']) !== jsonHash(materials)) throw precondition('原父停止受理已变化');
  });
  await current(); await physical.requestStop(original, materials, current);
  const state = await safety.get(id);
  const stopped = requireDevelopmentParentStop(original, materials, state);
  if (!await safety.admissionClosed(id)) throw precondition('原父准入关闭记录不符');
  await withDevelopmentParent(deps, id, identity, async (scope, environment, ending) => {
    if (ending.phase !== 'stop-intent' || jsonHash(ending.progress['materials']) !== jsonHash(materials)) throw precondition('原父最终停止来源已变化');
    const now = deps.clock.now();
    await advanceDevelopmentParent(scope, environment, ending, { ...ending, phase: 'proved', status: 'pending',
      progress: { ...ending.progress, stopProofHash: jsonHash(stopped.stopProof) }, message: '原父停止证明已持久确认，等待实例真正消失', retryAt: now }, now);
  });
}

import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentParentRebuildBindingSchema, DevelopmentParentRebuildSelectionSchema } from '../../../domain/development/parentRebuildBinding';
import type { EnvironmentRebuild } from '../../../domain/environmentRebuild';
import { rebuildIntent } from '../../../domain/physicalIdentity';
import { initialStartup } from '../../../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../../../domain/runnerToken';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { DevelopmentParentEnding } from '../../../ports/developmentParentEnding';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { workloadRenderOf, previewRouteOf } from '../../createEnvironment';

export interface ParentRebuildMaterials { readonly record: EnvironmentRebuild; readonly recordHash: string; readonly render?: TaskEnvironment['render']; readonly limit: number; readonly runnerTokenHash: string }
export function originalParentRebuildHash(record: EnvironmentRebuild): string {
  return jsonHash({ id: record.id, taskId: record.taskId, projectId: record.projectId, input: record.input, namespace: record.namespace,
    originalPodName: record.originalPodName, podName: record.podName, pvcName: record.pvcName, secretName: record.secretName, image: record.image,
    nodeName: record.nodeName ?? null, creation: record.creation ?? 'owner', binding: record.developmentParentBinding });
}
/** Profile/service preparation and all external reads finish before the publishing Project transaction. */
export async function prepareParentRebuildMaterials(deps: TaskRuntimeUseCaseDeps, ending: DevelopmentParentEnding, environment: TaskEnvironment,
  supplied?: EnvironmentRebuild): Promise<ParentRebuildMaterials> {
  const id = supplied?.id ?? ending.intent['rebuildId'];
  const record = supplied ?? (typeof id === 'string' ? await deps.uow.read.rebuilds.get(id) : undefined);
  if (!record || record.taskId !== environment.id || record.projectId !== environment.projectId || record.namespace !== environment.namespace
    || record.pvcName !== environment.pvcName || record.input.expectedVolumeUid !== ending.epoch.pvcUid || record.state !== 'queued') throw precondition('原受理恢复材料尚未就绪');
  const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding);
  if (binding.endingId !== ending.id || binding.epochHash !== ending.epochHash) throw precondition('恢复请求不是原退出的绑定');
  const service = record.creation === 'ledger' && environment.preview ? await deps.services.resolveServiceById(environment.serviceId) : undefined;
  if (record.creation === 'ledger' && environment.preview && !service) throw precondition('原预览所属服务不存在，恢复仍等待');
  const render = record.creation === 'ledger' ? { ...workloadRenderOf(deps.settings, record.input.profile, undefined,
    service ? previewRouteOf(deps.settings, environment, service.slug).previewRoute : undefined),
    ...(!service && environment.render?.previewRoute ? { previewRoute: environment.render.previewRoute } : {}),
    image: record.image, start: (environment.render?.start ?? 0) + 1,
    ...(environment.render?.runtimeImage ? { runtimeImage: environment.render.runtimeImage } : {}),
    ...(environment.render?.developmentObjectPlanId ? { developmentObjectPlanId: environment.render.developmentObjectPlanId } : {}),
    rebuild: { id: record.id, volumeUid: ending.epoch.pvcUid, intent: rebuildIntent(record), ...(record.nodeName ? { nodeName: record.nodeName } : {}),
      developmentParentSelection: DevelopmentParentRebuildSelectionSchema.parse({ version: 1, requestId: record.id, sourceEndingId: ending.id, sourceEpochHash: ending.epochHash }) } } : undefined;
  return { record, recordHash: originalParentRebuildHash(record), ...(render ? { render } : {}), limit: (await deps.quotas.quotaLimit(environment.projectId)) ?? 0,
    runnerTokenHash: hashRunnerToken(newRunnerToken()) };
}
export function nextParentRebuildEnvironment(environment: TaskEnvironment, materials: ParentRebuildMaterials, now: Date): TaskEnvironment {
  const { parentEnding: _ending, podUid: _pod, runnerRejection: _rejection, runtimeInitialization: _initialization, render: _render, ...original } = environment;
  return { ...original, ...(materials.render ? { render: materials.render } : {}), state: 'creating', podName: materials.record.podName,
    profile: materials.record.input.profile.id, rebuildId: materials.record.id, connected: false, runnerTokenHash: materials.runnerTokenHash,
    startup: initialStartup(now, { rebuild: true }), updatedAt: now, message: '原退出已确认，保留工作卷创建新的恢复环境' };
}

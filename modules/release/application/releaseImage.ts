import { loadExecutionMaterials } from './execution/executionMaterials';
import type { Manifest } from '@crewstation/contracts';
import { ManifestSchema, describeManifestFailure } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { Release } from '../domain/release';
import type { ReleaseUseCaseDeps } from './dependencies';

/** Manifest 和镜像选择先于外部构建固定；Git 标签后来被移动不改变本次发布。 */
export async function prepareReleaseImage(deps: ReleaseUseCaseDeps, release: Release): Promise<Release> {
  const manifest = release.manifest ?? await loadReleaseManifest(deps, release);
  release = { ...release, pipeline: { ...release.pipeline, executionMaterials: await loadExecutionMaterials(deps.repo, release, manifest) } };
  release = await retainTaskImages(deps, { ...release, manifest }, manifest);
  const versionId = manifest.spec.service.runtimeImageVersionId;
  if (!versionId) {
    const prepared = { ...release, manifest };
    await deps.uow.run((scope) => scope.releases.update(prepared));
    return prepared;
  }
  if (!deps.runtimeImages) throw precondition('平台尚未配置服务运行镜像能力');
  const snapshot = release.pipeline.runtimeImage ?? await deps.runtimeImages.reserve({ projectId: release.projectId, releaseId: release.id, userId: release.createdBy, versionId, service: manifest.spec.service });
  const prepared: Release = { ...release, manifest, image: snapshot.image, message: '使用已有镜像', pipeline: { ...release.pipeline, runtimeImage: snapshot } };
  // 先提交发布快照，再确认引用；崩溃重放会沿已保存快照确认，不重新选镜像。
  await deps.uow.run((scope) => scope.releases.update(prepared));
  await deps.runtimeImages.confirm(snapshot.versionId, release.id);
  return prepared;
}

export async function loadReleaseManifest(deps: ReleaseUseCaseDeps, release: Release): Promise<Manifest> {
  const text = await deps.repo.readFile(release.serviceId, release.commitSha, 'crewstation.yaml');
  if (!text) throw validation('固定源码提交中没有 crewstation.yaml');
  const parsed = ManifestSchema.safeParse(Bun.YAML.parse(text));
  if (!parsed.success) throw validation(`crewstation.yaml 无效：${describeManifestFailure(parsed.error)}`);
  return parsed.data;
}

/** 发布声明中的默认和允许版本都保留，避免服务上线后版本被删除才发现任务无法创建。 */
async function retainTaskImages(deps: ReleaseUseCaseDeps, release: Release, manifest: Manifest): Promise<Release> {
  const tasks = 'tasks' in manifest.spec ? manifest.spec.tasks : undefined;
  if (!tasks) return release;
  const hasImages = [tasks, ...tasks.agentProfiles].some((selection) => selection.runtimeImageVersionId || selection.allowedRuntimeImageVersionIds?.length);
  if (!hasImages) return release;
  if (!deps.runtimeImages?.reserveTaskImages || !deps.runtimeImages.confirmTaskImages) throw precondition('平台尚未配置发布任务镜像保留能力');
  const references = release.pipeline.runtimeImageSelections ?? await deps.runtimeImages.reserveTaskImages({ projectId: release.projectId, releaseId: release.id, userId: release.createdBy, tasks });
  const prepared = { ...release, pipeline: { ...release.pipeline, runtimeImageSelections: references } };
  await deps.uow.run((scope) => scope.releases.update(prepared));
  await deps.runtimeImages.confirmTaskImages(references);
  return prepared;
}
